/**
 * Main paper generation service
 *
 * Generates a LaTeX paper from a Deep Research conversation state,
 * compiles it to PDF, and uploads to storage.
 */

import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getServiceClient } from "../../db/client";
import {
  getConversation,
  getConversationState,
  getUser,
} from "../../db/operations";
import { LLM } from "../../llm/provider";
import { getStorageProvider } from "../../storage";
import type {
  ConversationStateValues,
  Discovery,
  PlanTask,
} from "../../types/core";
import logger from "../../utils/logger";
import type { PaperGenerationStage } from "../queue/types";
import {
  generateBackgroundPrompt,
  generateDiscoverySectionPrompt,
  generateFrontMatterPrompt,
} from "./prompts";
import type {
  DiscoverySection,
  FigureInfo,
  PaperGenerationResult,
  PaperMetadata,
} from "./types";
import { downloadDiscoveryFigures } from "./utils/artifacts";
import {
  deduplicateAndResolveCollisions,
  generateBibTeXFile,
  resolveMultipleDOIs,
  rewriteLatexCitations,
} from "./utils/bibtex";
import {
  checkForUndefinedCitations,
  compileLatexToPDF,
  extractLastLines,
} from "./utils/compile";
import { extractDOICitations, extractDOIsFromText } from "./utils/doi";
import { escapeLatex } from "./utils/escapeLatex";
import { processInlineDOICitations } from "./utils/inlineDoiCitations";

/**
 * Sanitize a JSON string by escaping invalid backslash sequences.
 * JSON only allows: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
 * LLMs often produce invalid sequences like \g, \p, \s from LaTeX or text.
 */
function sanitizeJsonString(jsonStr: string): string {
  // Replace invalid escape sequences: any backslash not followed by valid escape chars
  // Valid escapes: ", \, /, b, f, n, r, t, u (for \uXXXX)
  return jsonStr.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
}

/**
 * Safely parse JSON from LLM response, handling invalid escape sequences
 */
function safeJsonParse<T = unknown>(jsonStr: string, context: string): T {
  try {
    return JSON.parse(jsonStr);
  } catch (firstError) {
    // Try with sanitized JSON
    try {
      const sanitized = sanitizeJsonString(jsonStr);
      logger.warn(
        {
          context,
          originalError:
            firstError instanceof Error
              ? firstError.message
              : String(firstError),
        },
        "json_parse_sanitized",
      );
      return JSON.parse(sanitized);
    } catch (secondError) {
      // Log both errors and rethrow with context
      logger.error(
        {
          context,
          originalError:
            firstError instanceof Error
              ? firstError.message
              : String(firstError),
          sanitizedError:
            secondError instanceof Error
              ? secondError.message
              : String(secondError),
          jsonPreview: jsonStr.substring(0, 500),
        },
        "json_parse_failed_after_sanitization",
      );
      throw new Error(
        `Failed to parse JSON for ${context}: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
      );
    }
  }
}

// Use service client to bypass RLS - auth is verified before calling this service
const supabase = getServiceClient();

/**
 * Progress callback type for async paper generation
 */
export type ProgressCallback = (stage: PaperGenerationStage) => Promise<void>;

/**
 * Main entry point: Generate paper from conversation
 *
 * @param conversationId - The conversation to generate a paper from
 * @param userId - The user requesting the paper
 * @param existingPaperId - Optional pre-created paper ID (for async queue flow)
 * @param onProgress - Optional callback for progress updates (for async queue flow)
 */
export async function generatePaperFromConversation(
  conversationId: string,
  userId: string,
  existingPaperId?: string,
  onProgress?: ProgressCallback,
): Promise<PaperGenerationResult> {
  logger.info(
    { conversationId, userId, existingPaperId },
    "paper_generation_started",
  );

  // Report validating progress
  await onProgress?.("validating");

  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  if (conversation.user_id !== userId) {
    throw new Error(
      `User ${userId} does not own conversation ${conversationId}`,
    );
  }

  const conversationStateId = conversation.conversation_state_id;
  if (!conversationStateId) {
    throw new Error(
      `Conversation ${conversationId} has no conversation_state_id`,
    );
  }

  const stateRecord = await getConversationState(conversationStateId);
  if (!stateRecord) {
    throw new Error(`Conversation state not found: ${conversationStateId}`);
  }

  const state = stateRecord.values as ConversationStateValues;

  // Fetch user to check if they have an email for authorship
  const user = await getUser(userId);
  const userEmail = user?.email;

  // Generate authors string
  // Skip auto-generated emails (x402.local, temp.local, etc.)
  const isRealEmail =
    userEmail &&
    !userEmail.endsWith("@x402.local") &&
    !userEmail.endsWith("@temp.local") &&
    userEmail.includes("@");

  // Build agent author string only if AGENT_NAME is configured
  const agentName = process.env.AGENT_NAME;
  const agentEmail = process.env.AGENT_EMAIL;
  const agentAuthor = agentName
    ? (agentEmail ? `${agentName} (${agentEmail})` : agentName)
    : null;

  // Determine final authors string
  let authors: string;
  if (isRealEmail && agentAuthor) {
    authors = `${userEmail} \\and ${agentAuthor}`;
  } else if (isRealEmail) {
    authors = userEmail;
  } else if (agentAuthor) {
    authors = agentAuthor;
  } else {
    authors = "Anonymous";
  }

  logger.info(
    { userId, hasEmail: !!userEmail, isRealEmail, authors },
    "paper_authors_determined",
  );

  // Use existing paperId if provided (async flow), otherwise generate new one
  const paperId = existingPaperId || randomUUID();
  const pdfPath = `user/${userId}/conversation/${conversationId}/papers/${paperId}/paper.pdf`;

  // Only create paper record if not using an existing paperId (sync flow)
  if (!existingPaperId) {
    const { error: insertError } = await supabase.from("paper").insert({
      id: paperId,
      user_id: userId,
      conversation_id: conversationId,
      pdf_path: pdfPath,
      status: "processing", // Will be updated to "completed" at the end
    });

    if (insertError) {
      logger.error({ insertError }, "failed_to_create_paper_record");
      throw new Error(`Failed to create paper record: ${insertError.message}`);
    }

    logger.info({ paperId }, "paper_record_created");
  } else {
    logger.info({ paperId: existingPaperId }, "using_existing_paper_record");
  }

  const workDir = path.join(os.tmpdir(), "paper", paperId);
  const latexDir = path.join(workDir, "latex");
  const figuresDir = path.join(latexDir, "figures");

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(latexDir, { recursive: true });
  fs.mkdirSync(figuresDir, { recursive: true });

  try {
    const tasksByJobId = indexTasksByJobId(state);
    const discoveryContexts = mapDiscoveriesToTasks(state, tasksByJobId);

    // Collect all tasks referenced in discovery evidence
    const evidenceTaskIds = new Set<string>();
    for (const ctx of discoveryContexts) {
      for (const task of ctx.allowedTasks) {
        if (task.jobId) evidenceTaskIds.add(task.jobId);
        if (task.id) evidenceTaskIds.add(task.id);
      }
    }
    const evidenceTasks = Array.from(evidenceTaskIds)
      .map((id) => tasksByJobId.get(id))
      .filter((task): task is PlanTask => task !== undefined);

    // Report metadata progress
    await onProgress?.("metadata");

    const metadata = await generatePaperMetadata(
      state,
      evidenceTasks,
      authors,
      paperId,
    );

    // Report figures progress
    await onProgress?.("figures");

    const allFigures: Map<number, FigureInfo[]> = new Map();
    for (let i = 0; i < discoveryContexts.length; i++) {
      const ctx = discoveryContexts[i];
      const figures = await downloadDiscoveryFigures(
        ctx!.allowedTasks,
        i + 1,
        figuresDir,
        userId,
        conversationStateId,
      );
      allFigures.set(i, figures);
    }

    // Report discoveries progress
    await onProgress?.("discoveries");

    const discoverySections = await generateDiscoverySectionsParallel(
      discoveryContexts,
      allFigures,
      figuresDir,
      3,
      paperId,
    );

    let mainTexContent = assembleMainTex(metadata, discoverySections);

    // Report bibliography progress
    await onProgress?.("bibliography");

    const allDOIs = extractDOICitations(mainTexContent);
    const discoveryBibEntries = await resolveMultipleDOIs(allDOIs);
    logger.info(
      { resolved: discoveryBibEntries.length, total: allDOIs.length },
      "dois_resolved",
    );

    // Use the structured BibTeX entries directly from metadata
    // This avoids fragile regex parsing of the string bibliography
    const inlineBibEntries = metadata.inlineBibEntries;

    logger.info(
      {
        inlineBibEntriesCount: inlineBibEntries.length,
        doiToCitekeyCount: metadata.inlineDOIToCitekey.size,
      },
      "inline_bib_entries_loaded",
    );

    const allBibEntries = [...inlineBibEntries, ...discoveryBibEntries];
    const dedupedBibEntries = deduplicateAndResolveCollisions(allBibEntries);
    const doiToCitekeyMap = new Map(
      dedupedBibEntries.map((e) => [e.doi, e.citekey]),
    );

    mainTexContent = rewriteLatexCitations(mainTexContent, doiToCitekeyMap);

    // Sanitize any remaining unresolved DOI citations to prevent LaTeX errors
    // Convert \cite{doi:10.xxx/yyy} to inline text (DOI: 10.xxx/yyy)
    mainTexContent = sanitizeUnresolvedCitations(mainTexContent);

    // Report latex_assembly progress
    await onProgress?.("latex_assembly");

    fs.writeFileSync(path.join(latexDir, "main.tex"), mainTexContent);

    const mergedBibContent = generateBibTeXFile(dedupedBibEntries);
    fs.writeFileSync(path.join(latexDir, "references.bib"), mergedBibContent);

    const citekeysInMainTex = extractCitekeys(mainTexContent);
    const citekeysInBib = extractCitekeyFromBibTeX(mergedBibContent);
    const missingInBib = citekeysInMainTex.filter(
      (key) => !citekeysInBib.includes(key),
    );

    validateCitations(
      mainTexContent,
      citekeysInMainTex,
      citekeysInBib,
      missingInBib,
    );

    // Report compilation progress
    await onProgress?.("compilation");

    logger.info("compiling_latex");
    let compileResult = await compileLatexToPDF(workDir);
    let usedLastResortFallback = false;

    // First compilation attempt failed - try recovery strategies
    if (!compileResult.success || !compileResult.pdfPath) {
      const errorLogs = extractLastLines(compileResult.logs, 200);
      logger.warn(
        { errorLogs },
        "latex_compilation_failed_attempting_recovery",
      );

      // Check for undefined citations and remove them
      const undefinedCitations = checkForUndefinedCitations(compileResult.logs);
      if (undefinedCitations.length > 0) {
        logger.warn(
          { undefinedCitations, count: undefinedCitations.length },
          "removing_undefined_citations",
        );

        mainTexContent = removeUndefinedCitations(
          mainTexContent,
          undefinedCitations,
        );
        fs.writeFileSync(path.join(latexDir, "main.tex"), mainTexContent);

        logger.info("recompiling_latex_after_removing_undefined_citations");
        compileResult = await compileLatexToPDF(workDir);
      }

      // If still failing, try last-resort: strip ALL citations
      if (!compileResult.success || !compileResult.pdfPath) {
        logger.warn(
          "compilation_still_failing_using_last_resort_strip_all_citations",
        );

        mainTexContent = stripAllCitations(mainTexContent);
        fs.writeFileSync(path.join(latexDir, "main.tex"), mainTexContent);
        // Also clear the references.bib since we're not using it
        fs.writeFileSync(path.join(latexDir, "references.bib"), "");

        logger.info("recompiling_latex_without_citations");
        compileResult = await compileLatexToPDF(workDir);
        usedLastResortFallback = true;

        // If STILL failing after stripping citations, we have a non-citation problem
        if (!compileResult.success || !compileResult.pdfPath) {
          const finalErrorLogs = extractLastLines(compileResult.logs, 200);
          logger.error(
            { errorLogs: finalErrorLogs },
            "latex_compilation_failed_even_without_citations",
          );
          // Only delete paper record if we created it (sync flow)
          if (!existingPaperId) {
            await supabase.from("paper").delete().eq("id", paperId);
          }
          throw new Error(
            `LaTeX compilation failed (even without citations):\n${finalErrorLogs}`,
          );
        }
      }
    } else {
      // First compilation succeeded - check for undefined citations anyway
      const undefinedCitations = checkForUndefinedCitations(compileResult.logs);
      if (undefinedCitations.length > 0) {
        logger.warn(
          { undefinedCitations, count: undefinedCitations.length },
          "removing_undefined_citations",
        );

        mainTexContent = removeUndefinedCitations(
          mainTexContent,
          undefinedCitations,
        );
        fs.writeFileSync(path.join(latexDir, "main.tex"), mainTexContent);

        logger.info("recompiling_latex");
        compileResult = await compileLatexToPDF(workDir);

        if (!compileResult.success || !compileResult.pdfPath) {
          // Try last-resort fallback
          logger.warn("recompilation_failed_using_last_resort");
          mainTexContent = stripAllCitations(mainTexContent);
          fs.writeFileSync(path.join(latexDir, "main.tex"), mainTexContent);
          fs.writeFileSync(path.join(latexDir, "references.bib"), "");

          compileResult = await compileLatexToPDF(workDir);
          usedLastResortFallback = true;

          if (!compileResult.success || !compileResult.pdfPath) {
            const errorLogs = extractLastLines(compileResult.logs, 200);
            logger.error({ errorLogs }, "latex_recompilation_failed");
            // Only delete paper record if we created it (sync flow)
            if (!existingPaperId) {
              await supabase.from("paper").delete().eq("id", paperId);
            }
            throw new Error(`LaTeX recompilation failed:\n${errorLogs}`);
          }
        }

        const remainingUndefined = checkForUndefinedCitations(
          compileResult.logs,
        );
        if (remainingUndefined.length > 0) {
          logger.warn({ remainingUndefined }, "citations_still_undefined");
        }
      }
    }

    if (usedLastResortFallback) {
      logger.warn(
        "paper_generated_without_bibliography_due_to_citation_errors",
      );
    }

    // Report upload progress
    await onProgress?.("upload");

    const storage = getStorageProvider();
    if (!storage) {
      throw new Error("Storage provider not available");
    }

    const pdfBuffer = fs.readFileSync(compileResult.pdfPath);
    await storage.upload(pdfPath, pdfBuffer, "application/pdf");

    const rawLatexPath = `user/${userId}/conversation/${conversationId}/papers/${paperId}/main.tex`;
    const rawLatexBuffer = Buffer.from(mainTexContent, "utf-8");
    await storage.upload(rawLatexPath, rawLatexBuffer, "text/plain");

    const pdfUrl = await storage.getPresignedUrl(pdfPath, 3600);
    const rawLatexUrl = await storage.getPresignedUrl(rawLatexPath, 3600);

    // Report cleanup progress
    await onProgress?.("cleanup");

    cleanupWorkDir(workDir);

    // Update status to completed (sync flow only - async flow handled by worker)
    if (!existingPaperId) {
      const { error: updateError } = await supabase
        .from("paper")
        .update({ status: "completed" })
        .eq("id", paperId);

      if (updateError) {
        logger.warn({ updateError, paperId }, "failed_to_update_paper_status");
      }
    }

    logger.info({ paperId }, "paper_generation_completed");

    return {
      paperId,
      conversationId,
      conversationStateId,
      pdfPath,
      pdfUrl,
      rawLatexUrl,
    };
  } catch (error) {
    // Cleanup on error
    cleanupWorkDir(workDir);

    // Only delete paper record if we created it (sync flow)
    // In async flow (existingPaperId provided), the worker handles status updates
    if (!existingPaperId) {
      await supabase.from("paper").delete().eq("id", paperId);
    }

    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        conversationId,
      },
      "paper_generation_failed",
    );
    throw error;
  }
}

/**
 * Index tasks by jobId for quick lookup
 */
function indexTasksByJobId(
  state: ConversationStateValues,
): Map<string, PlanTask> {
  const map = new Map<string, PlanTask>();

  if (state.plan) {
    for (const task of state.plan) {
      if (task.jobId) {
        map.set(task.jobId, task);
      }
      if (task.id) {
        map.set(task.id, task);
      }
    }
  }

  return map;
}

/**
 * Check if a job ID is valid (not a placeholder or invalid value)
 */
function isValidJobId(jobId: string | undefined | null): jobId is string {
  if (!jobId) return false;
  const invalid = ["N/A", "undefined", "null", ""];
  return !invalid.includes(jobId.trim());
}

/**
 * Map discoveries to their allowed tasks
 */
function mapDiscoveriesToTasks(
  state: ConversationStateValues,
  tasksByJobId: Map<string, PlanTask>,
): Array<{
  discovery: Discovery;
  index: number;
  allowedTasks: PlanTask[];
}> {
  if (!state.discoveries || state.discoveries.length === 0) {
    state.discoveries = [];
  }

  // Get all tasks as fallback for legacy conversations
  const allTasks = state.plan || [];

  return state.discoveries.map((discovery, index) => {
    let allJobIds: string[] = [];
    let hasInvalidJobIds = false;

    if (discovery.evidenceArray && discovery.evidenceArray.length > 0) {
      allJobIds = discovery.evidenceArray.map((ev) => ev.jobId || ev.taskId);
      // Check if any evidence has invalid job IDs (legacy bug)
      hasInvalidJobIds = allJobIds.some((id) => !isValidJobId(id));
      allJobIds = allJobIds.filter(isValidJobId);
    }

    // Fallback to discovery.jobId if evidenceArray didn't yield valid IDs
    if (allJobIds.length === 0) {
      const jobId = (discovery as any).jobId;
      if (isValidJobId(jobId)) {
        allJobIds = [jobId];
      } else if (jobId) {
        hasInvalidJobIds = true;
      }
    }

    const allowedTasks = allJobIds
      .map((jobId) => tasksByJobId.get(jobId))
      .filter((task): task is PlanTask => task !== undefined);

    // If any evidence had invalid job IDs, include all tasks as fallback
    // This ensures we don't miss figures/context from legacy evidence
    if (hasInvalidJobIds) {
      logger.warn(
        { discoveryIndex: index + 1, validJobIds: allJobIds },
        "discovery_has_invalid_job_ids_including_all_tasks",
      );
      // Merge: specific tasks + all tasks (deduplicated)
      const taskIds = new Set(allowedTasks.map((t) => t.jobId || t.id));
      for (const task of allTasks) {
        if (!taskIds.has(task.jobId) && !taskIds.has(task.id)) {
          allowedTasks.push(task);
        }
      }
    }

    // If still no tasks, use all tasks
    if (allowedTasks.length === 0) {
      logger.warn(
        { discoveryIndex: index + 1 },
        "discovery_no_valid_tasks_using_all",
      );
      return { discovery, index, allowedTasks: allTasks };
    }

    return { discovery, index, allowedTasks };
  });
}

/**
 * Generate paper metadata (uses LLM for title/abstract/background/snapshot, deterministic for rest)
 */
async function generatePaperMetadata(
  state: ConversationStateValues,
  evidenceTasks: PlanTask[],
  authors: string,
  paperId?: string,
): Promise<PaperMetadata> {
  logger.info("generating_paper_front_matter");

  // Use LLM to generate title, abstract, and research snapshot
  const frontMatterPrompt = generateFrontMatterPrompt(state);

  const LLM_PROVIDER = (process.env.PAPER_GEN_LLM_PROVIDER || "openai") as any;
  const LLM_MODEL = process.env.PAPER_GEN_LLM_MODEL || "gpt-4o";
  const apiKey =
    process.env[`${LLM_PROVIDER.toUpperCase()}_API_KEY`] ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";

  if (!apiKey) {
    throw new Error(
      `API key not configured for paper generation LLM provider: ${LLM_PROVIDER}`,
    );
  }

  const llm = new LLM({
    name: LLM_PROVIDER,
    apiKey,
  } as any);

  // Generate front matter
  const frontMatterResponse = await llm.createChatCompletion({
    messages: [{ role: "user", content: frontMatterPrompt }],
    model: LLM_MODEL,
    temperature: 0.3,
    maxTokens: 3000,
    paperId,
    usageType: "paper-generation",
  });

  const frontMatterContent = frontMatterResponse.content || "";

  // Parse front matter JSON response
  const frontMatterJsonMatch = frontMatterContent.match(/\{[\s\S]*\}/);
  if (!frontMatterJsonMatch) {
    throw new Error(
      `No JSON found in LLM response for front matter. Content preview: ${frontMatterContent.substring(0, 300)}`,
    );
  }

  const frontMatterParsed = safeJsonParse<{
    title?: string;
    abstract?: string;
    researchSnapshot?: string;
  }>(frontMatterJsonMatch[0], "front_matter");

  if (
    !frontMatterParsed.title ||
    !frontMatterParsed.abstract ||
    !frontMatterParsed.researchSnapshot
  ) {
    throw new Error(
      `Missing fields in front matter response. Keys found: ${Object.keys(frontMatterParsed).join(", ")}`,
    );
  }

  // XeLaTeX handles Unicode natively - no conversion needed
  const title = frontMatterParsed.title;
  const abstract = frontMatterParsed.abstract;
  const researchSnapshot = frontMatterParsed.researchSnapshot;

  // Generate background section
  logger.info("generating_background_section");
  const backgroundPrompt = generateBackgroundPrompt(state, evidenceTasks);

  const backgroundResponse = await llm.createChatCompletion({
    messages: [{ role: "user", content: backgroundPrompt }],
    model: LLM_MODEL,
    temperature: 0.3,
    maxTokens: 5000,
    paperId,
    usageType: "paper-generation",
  });

  const backgroundContent = backgroundResponse.content || "";
  // Parse background JSON response
  const backgroundJsonMatch = backgroundContent.match(/\{[\s\S]*\}/);
  if (!backgroundJsonMatch) {
    throw new Error(
      `No JSON found in LLM response for background. Content preview: ${backgroundContent.substring(0, 300)}`,
    );
  }

  const backgroundParsed = safeJsonParse<{
    background?: string;
    keyInsights?: string;
  }>(backgroundJsonMatch[0], "background");

  if (!backgroundParsed.background) {
    throw new Error(
      `Missing background field in response. Keys found: ${Object.keys(backgroundParsed).join(", ")}`,
    );
  }

  const background = backgroundParsed.background;

  // Generate deterministic sections
  const keyInsights = state.keyInsights || [];

  const summaryItems =
    state.discoveries?.map((d, i) => {
      const discoveryTitle = escapeLatex(d.title || `Discovery ${i + 1}`);
      const claim = escapeLatex(d.claim);
      return `\\textbf{Discovery ${i + 1} - ${discoveryTitle}:} ${claim}`;
    }) || [];
  const summaryOfDiscoveries = summaryItems.join("\n\n\\vspace{0.5em}\n\n");

  logger.info("paper_front_matter_generated");

  // Convert parenthesized DOI URLs to square bracket format for processing
  // e.g., (https://doi.org/10.1234/abcd) → [doi:10.1234/abcd]
  // e.g., (https://doi.org/10.1234/a; https://doi.org/10.5678/b) → [doi:10.1234/a,doi:10.5678/b]
  // IMPORTANT: Must run BEFORE escapeLatex to avoid corrupting DOIs with special chars
  const normalizeKeyInsightDOIs = (text: string): string => {
    return text.replace(
      /\((https?:\/\/doi\.org\/[^)]+)\)/g,
      (match, urlContent) => {
        const dois = urlContent
          .split(/[;,]/)
          .map((url: string) => {
            const doiMatch = url.trim().match(/10\.\d{4,}[^\s;,)]+/);
            return doiMatch
              ? `doi:${doiMatch[0].replace(/[\.\s]+$/, "")}`
              : null;
          })
          .filter(Boolean);
        return dois.length > 0 ? `[${dois.join(",")}]` : match;
      },
    );
  };

  // Normalize key insight DOIs BEFORE escaping (to match background flow)
  const normalizedKeyInsights = keyInsights.map(normalizeKeyInsightDOIs);
  const escapedKeyInsights = normalizedKeyInsights.map(escapeLatex);
  const escapedBackground = escapeLatex(background);

  // Combine all text that needs DOI citation processing
  const keyInsightsText = escapedKeyInsights.join("\n\n");
  const combinedText = `${escapedBackground}\n\n${keyInsightsText}\n\n${summaryOfDiscoveries}`;

  // Process all inline DOI citations at once
  const doiResult = await processInlineDOICitations(combinedText);

  // Split the processed text back into sections
  const allLines = doiResult.updatedText.split("\n\n");

  // Background may span multiple paragraphs, so count them
  const backgroundParagraphCount = escapedBackground.split("\n\n").length;
  const processedBackground = allLines
    .slice(0, backgroundParagraphCount)
    .join("\n\n");

  // Then key insights
  const processedKeyInsights = allLines.slice(
    backgroundParagraphCount,
    backgroundParagraphCount + keyInsights.length,
  );

  // Then summary of discoveries (everything remaining)
  const processedSummary = allLines
    .slice(backgroundParagraphCount + keyInsights.length)
    .join("\n\n");

  return {
    title: escapeLatex(title),
    authors, // User + Aubrai if user has email, otherwise just Aubrai
    abstract: escapeLatex(abstract),
    background: processedBackground, // Now includes processed DOI citations
    researchSnapshot: escapeLatex(researchSnapshot),
    keyInsights: processedKeyInsights, // Already escaped before DOI processing
    summaryOfDiscoveries: processedSummary, // Already escaped before DOI processing
    inlineBibliography: doiResult.referencesBib,
    inlineBibEntries: doiResult.bibEntries, // Structured entries - no re-parsing needed!
    inlineDOIToCitekey: doiResult.doiToCitekey, // DOI → author-year citekey mapping
  };
}

async function generateDiscoverySectionsParallel(
  contexts: Array<{
    discovery: Discovery;
    index: number;
    allowedTasks: PlanTask[];
  }>,
  allFigures: Map<number, FigureInfo[]>,
  figuresDir: string,
  maxConcurrency: number,
  paperId?: string,
): Promise<DiscoverySection[]> {
  const results: DiscoverySection[] = [];

  for (let i = 0; i < contexts.length; i += maxConcurrency) {
    const batch = contexts.slice(i, i + maxConcurrency);

    const batchResults = await Promise.all(
      batch.map((ctx) =>
        generateDiscoverySection(
          ctx.discovery,
          ctx.index + 1,
          ctx.allowedTasks,
          allFigures.get(ctx.index) || [],
          figuresDir,
          paperId,
        ),
      ),
    );

    results.push(...batchResults);
  }

  return results;
}

async function generateDiscoverySection(
  discovery: Discovery,
  discoveryIndex: number,
  allowedTasks: PlanTask[],
  figures: FigureInfo[],
  figuresDir: string,
  paperId?: string,
): Promise<DiscoverySection> {
  const allowedDOIs: string[] = [];
  for (const task of allowedTasks) {
    if (task.output) {
      const dois = extractDOIsFromText(task.output);
      allowedDOIs.push(...dois);
    }
  }

  const uniqueAllowedDOIs = Array.from(new Set(allowedDOIs));

  // Calculate task output stats for logging
  const taskOutputStats = allowedTasks.map((task) => ({
    jobId: task.jobId,
    type: task.type,
    outputLength: task.output?.length || 0,
  }));
  const totalTaskOutputChars = taskOutputStats.reduce(
    (sum, t) => sum + t.outputLength,
    0,
  );

  logger.info(
    {
      discoveryIndex,
      taskCount: allowedTasks.length,
      figureCount: figures.length,
      figureFilenames: figures.map((f) => f.filename),
      taskTypes: allowedTasks.map((t) => t.type),
      totalTaskOutputChars,
      taskOutputStats,
    },
    "generating_discovery_section",
  );

  let prompt = generateDiscoverySectionPrompt(
    discovery,
    discoveryIndex,
    allowedTasks,
    figures,
    uniqueAllowedDOIs,
  );

  // Log prompt size
  logger.info(
    {
      discoveryIndex,
      promptLength: prompt.length,
      promptLengthKB: Math.round(prompt.length / 1024),
    },
    "discovery_prompt_generated",
  );

  const LLM_PROVIDER = (process.env.PAPER_GEN_LLM_PROVIDER || "openai") as any;
  const LLM_MODEL = process.env.PAPER_GEN_LLM_MODEL || "gpt-4o";
  const apiKey =
    process.env[`${LLM_PROVIDER.toUpperCase()}_API_KEY`] ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";

  if (!apiKey) {
    throw new Error(
      `API key not configured for paper generation LLM provider: ${LLM_PROVIDER}`,
    );
  }

  const llm = new LLM({
    name: LLM_PROVIDER,
    apiKey,
  } as any);

  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    try {
      // Build message content with images for vision-capable models
      let messageContent: any;

      if (LLM_PROVIDER === "anthropic" && figures.length > 0) {
        // Anthropic vision support: encode images as base64
        // Limits per Claude docs: 5MB per image, 100 images per request
        const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
        const MAX_IMAGES_PER_REQUEST = 100;

        const contentBlocks: any[] = [];
        const figureSizes: Array<{ filename: string; sizeKB: number }> = [];
        const skippedFigures: Array<{ filename: string; reason: string }> = [];
        let totalImageSizeBytes = 0;
        let imageCount = 0;

        for (const figure of figures) {
          // Enforce image count limit
          if (imageCount >= MAX_IMAGES_PER_REQUEST) {
            skippedFigures.push({
              filename: figure.filename,
              reason: `Exceeded ${MAX_IMAGES_PER_REQUEST} image limit`,
            });
            continue;
          }

          try {
            const figPath = path.join(figuresDir, figure.filename);
            if (fs.existsSync(figPath)) {
              const imageBuffer = fs.readFileSync(figPath);

              // Enforce per-image size limit (5MB)
              if (imageBuffer.length > MAX_IMAGE_SIZE_BYTES) {
                skippedFigures.push({
                  filename: figure.filename,
                  reason: `Exceeds 5MB limit (${(imageBuffer.length / (1024 * 1024)).toFixed(2)}MB)`,
                });
                continue;
              }

              const base64Image = imageBuffer.toString("base64");
              const mediaType = getImageMediaType(figure.filename);

              figureSizes.push({
                filename: figure.filename,
                sizeKB: Math.round(imageBuffer.length / 1024),
              });
              totalImageSizeBytes += imageBuffer.length;
              imageCount++;

              contentBlocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Image,
                },
              });
            }
          } catch (error) {
            logger.warn(
              { figure: figure.filename, error },
              "failed_to_encode_image",
            );
          }
        }

        if (skippedFigures.length > 0) {
          logger.warn({ skippedFigures }, "figures_skipped_due_to_limits");
        }

        // Log figure sizes being sent to LLM
        logger.info(
          {
            discoveryIndex,
            figureCount: figureSizes.length,
            figureSizes,
            totalImageSizeKB: Math.round(totalImageSizeBytes / 1024),
            totalImageSizeMB: (totalImageSizeBytes / (1024 * 1024)).toFixed(2),
          },
          "discovery_figures_encoded_for_llm",
        );

        contentBlocks.push({
          type: "text",
          text: prompt,
        });

        messageContent = contentBlocks;
      } else if (LLM_PROVIDER === "openai" && figures.length > 0) {
        // TODO: Add OpenAI vision support (gpt-4o, gpt-4-vision)
        // OpenAI uses a different format:
        // content: [
        //   { type: "text", text: prompt },
        //   { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }
        // ]
        messageContent = prompt;
      } else if (LLM_PROVIDER === "google" && figures.length > 0) {
        // TODO: Add Google (Gemini) vision support
        messageContent = prompt;
      } else {
        messageContent = prompt;
      }

      const llmStartTime = Date.now();

      const response = await llm.createChatCompletion({
        messages: [{ role: "user", content: messageContent }],
        model: LLM_MODEL,
        temperature: 0.3,
        maxTokens: 8000,
        paperId,
        usageType: "paper-generation",
      });

      const llmDurationMs = Date.now() - llmStartTime;
      const content = response.content || "";

      // Log LLM call duration and response size
      logger.info(
        {
          discoveryIndex,
          llmDurationMs,
          llmDurationSec: (llmDurationMs / 1000).toFixed(1),
          responseLength: content.length,
          responseLengthKB: Math.round(content.length / 1024),
        },
        "discovery_llm_call_completed",
      );

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(
          `No JSON found in LLM response. Content preview: ${content.substring(0, 300)}`,
        );
      }

      const parsed = safeJsonParse<{
        sectionLatex?: string;
        usedDois?: string[];
      }>(jsonMatch[0], `discovery_section_${discoveryIndex}`);

      if (!parsed.sectionLatex) {
        throw new Error(
          `Missing sectionLatex in response. Keys found: ${Object.keys(parsed).join(", ")}`,
        );
      }

      // XeLaTeX handles Unicode natively - no conversion needed
      return {
        discoveryIndex,
        sectionLatex: parsed.sectionLatex,
        usedDois: parsed.usedDois || [],
      };
    } catch (error) {
      attempt++;
      logger.warn(
        { attempt, error, discoveryIndex },
        "failed_to_generate_discovery_section",
      );

      if (attempt >= maxAttempts) {
        throw new Error(
          `Failed to generate discovery section ${discoveryIndex} after ${maxAttempts} attempts: ${error}`,
        );
      }

      // Retry with correction prompt
      prompt +=
        "\n\nThe previous response was invalid. Return ONLY valid JSON with sectionLatex and usedDois fields. No markdown, no code blocks.";
    }
  }

  throw new Error("Unreachable");
}

/**
 * Assemble main.tex from metadata and discovery sections
 */
function assembleMainTex(
  metadata: PaperMetadata,
  discoverySections: DiscoverySection[],
): string {
  // XeLaTeX template - native Unicode support (no inputenc needed)
  return `\\documentclass[11pt,a4paper]{article}
\\usepackage{fontspec}  % XeLaTeX font handling
\\usepackage{graphicx}
\\usepackage[numbers]{natbib}
\\usepackage{hyperref}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\graphicspath{{figures/}}

\\title{${metadata.title}}
\\author{${metadata.authors}}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
${metadata.abstract}
\\end{abstract}

\\section{Background}
${metadata.background}

\\section{Research Snapshot}
${metadata.researchSnapshot}

\\section{Key Insights}
\\begin{itemize}
${metadata.keyInsights.map((insight) => `\\item ${insight}`).join("\n")}
\\end{itemize}

\\section{Summary of Discoveries}
${metadata.summaryOfDiscoveries}

${discoverySections.map((ds) => ds.sectionLatex).join("\n\n")}

\\bibliographystyle{plainnat}
\\bibliography{references}

\\end{document}
`;
}

/**
 * Sanitize unresolved DOI citations to prevent LaTeX compilation errors
 * Converts \cite{doi:10.xxx/yyy} to inline text (DOI: 10.xxx/yyy)
 * This prevents crashes from escaped underscores in unresolved DOI citations
 */
function sanitizeUnresolvedCitations(latexContent: string): string {
  let sanitized = latexContent;
  let sanitizedCount = 0;

  // Match \cite{...} or \citep{...} or \citet{...} containing unresolved DOI patterns
  // Pattern matches citations containing doi: or doi_ that weren't resolved to proper citekeys
  const unresolvedCiteRegex =
    /\\cite[pt]?\{([^}]*(?:doi:|doi_|10\.\d{4,}\/)[^}]*)\}/g;

  sanitized = latexContent.replace(unresolvedCiteRegex, (_match, citations) => {
    // Split multiple citations in the same \cite{} command
    const citationList = citations.split(",").map((c: string) => c.trim());

    const resolvedCites: string[] = [];
    const inlineDOIs: string[] = [];

    for (const citation of citationList) {
      // Check if this citation is an unresolved DOI pattern
      const isDOICitation =
        citation.startsWith("doi:") ||
        citation.startsWith("doi_") ||
        /^10\.\d{4,}\//.test(citation);

      if (isDOICitation) {
        // Extract the DOI part
        let doi = citation;
        if (citation.startsWith("doi:")) {
          doi = citation.substring(4);
        } else if (citation.startsWith("doi_")) {
          // Convert doi_10_xxxx_yyyy back to 10.xxxx/yyyy
          doi = citation
            .substring(4)
            .replace(/_/g, "/")
            .replace(/^(\d+)\//, "$1.");
        }
        // Remove any LaTeX escapes that might have been introduced
        doi = doi.replace(/\\_/g, "_").replace(/\\&/g, "&");
        inlineDOIs.push(doi);
        sanitizedCount++;
      } else {
        // Keep resolved citations
        resolvedCites.push(citation);
      }
    }

    // Build result
    let result = "";

    // If we have resolved citations, keep them in a \cite{}
    if (resolvedCites.length > 0) {
      result += `\\cite{${resolvedCites.join(",")}}`;
    }

    // Add inline DOIs as text
    if (inlineDOIs.length > 0) {
      const doiText = inlineDOIs.map((d) => `DOI: ${d}`).join("; ");
      if (result) {
        result += ` (${doiText})`;
      } else {
        result = `(${doiText})`;
      }
    }

    return result;
  });

  if (sanitizedCount > 0) {
    logger.info(
      { sanitizedCount },
      "sanitized_unresolved_doi_citations_to_inline_text",
    );
  }

  return sanitized;
}

/**
 * Strip ALL citations from LaTeX content (last-resort fallback)
 * Used when compilation fails even after sanitization
 */
function stripAllCitations(latexContent: string): string {
  let stripped = latexContent;

  // Remove all \cite{...}, \citep{...}, \citet{...} commands
  stripped = stripped.replace(/\\cite[pt]?\{[^}]*\}/g, "");

  // Remove bibliography commands
  stripped = stripped.replace(/\\bibliographystyle\{[^}]*\}/g, "");
  stripped = stripped.replace(/\\bibliography\{[^}]*\}/g, "");

  // Clean up any double spaces or awkward punctuation left behind
  stripped = stripped.replace(/\s+\./g, ".");
  stripped = stripped.replace(/\s+,/g, ",");
  stripped = stripped.replace(/\(\s*\)/g, ""); // Remove empty parentheses
  stripped = stripped.replace(/\s{2,}/g, " "); // Multiple spaces to single

  logger.warn("stripped_all_citations_for_last_resort_compilation");

  return stripped;
}

/**
 * Remove specific undefined citations from LaTeX content
 */
function removeUndefinedCitations(
  latexContent: string,
  undefinedCitations: string[],
): string {
  if (undefinedCitations.length === 0) {
    return latexContent;
  }

  let cleaned = latexContent;

  // For each undefined citation, remove all occurrences
  for (const citekey of undefinedCitations) {
    // Escape special regex characters in the citekey
    const escapedKey = citekey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Pattern to match this citation in any form:
    // \cite{key}, \citep{key}, \citet{key}
    // Also handle multiple citations: \cite{key1,key2,key3}
    const patterns = [
      // Standalone citation: \cite{key} or \citep{key}
      new RegExp(`\\\\cite[pt]?\\{${escapedKey}\\}`, "g"),
      // Citation at start of list: \cite{key,other}
      new RegExp(`\\\\cite[pt]?\\{${escapedKey},([^}]+)\\}`, "g"),
      // Citation in middle of list: \cite{other,key,another}
      new RegExp(`(\\\\cite[pt]?\\{[^}]*),${escapedKey},([^}]+\\})`, "g"),
      // Citation at end of list: \cite{other,key}
      new RegExp(`(\\\\cite[pt]?\\{[^}]*),${escapedKey}\\}`, "g"),
    ];

    // Apply patterns in order
    // Pattern 0: Remove standalone \cite{key}
    cleaned = cleaned.replace(patterns[0]!, "");
    // Pattern 1: Remove key from start of list: \cite{key,other} => \cite{other}
    cleaned = cleaned.replace(patterns[1]!, "\\cite{$1}");
    // Pattern 2: Remove key from middle of list: \cite{a,key,b} => \cite{a,b}
    cleaned = cleaned.replace(patterns[2]!, "$1,$2");
    // Pattern 3: Remove key from end of list: \cite{other,key} => \cite{other}
    cleaned = cleaned.replace(patterns[3]!, "$1}");

    logger.info({ citekey, removed: true }, "removed_undefined_citation");
  }

  return cleaned;
}

/**
 * Validate citations in LaTeX content
 * Catches common citation formatting errors and missing citekeys before compilation
 */
function validateCitations(
  latexContent: string,
  citekeysInMainTex: string[],
  citekeysInBib: string[],
  missingInBib: string[],
): void {
  const errors: string[] = [];

  // Check 1: No \{}cite (escaped backslash)
  if (latexContent.includes("\\{}cite")) {
    errors.push(
      "Invalid citation format: \\{}cite found. Citations should be \\cite{...}, not \\{}cite{...}",
    );
  }

  // Check 2: No spaces inside cite braces
  const spacesInCiteRegex = /\\cite[pt]?\{[^}]*\s+[^}]*\}/;
  const spacesMatch = latexContent.match(spacesInCiteRegex);
  if (spacesMatch) {
    errors.push(
      `Invalid citation format: spaces found inside citation braces: ${spacesMatch[0]}. ` +
        `Citations must use format \\cite{key} with no spaces.`,
    );
  }

  // Check 3: Warn about remaining doi: placeholders (but don't fail - we're debugging)
  const placeholderRegex = /\\cite[pt]?\{[^}]*doi:[^}]*\}/;
  const placeholderMatch = latexContent.match(placeholderRegex);
  if (placeholderMatch) {
    logger.warn(
      { example: placeholderMatch[0] },
      "unresolved_doi_placeholder_found_will_attempt_compilation",
    );
  }

  // Check 4: Warn about remaining DOI patterns (but don't fail)
  const doiUnderscoreRegex = /\\cite[pt]?\{[^}]*doi_[^}]*\}/;
  const doiUnderscoreMatch = latexContent.match(doiUnderscoreRegex);
  if (doiUnderscoreMatch) {
    logger.warn(
      { example: doiUnderscoreMatch[0] },
      "unresolved_doi_underscore_format_found",
    );
  }

  const rawDoiRegex = /\\cite[pt]?\{[^}]*10\.\d{4,}\/[^}]*\}/;
  const rawDoiMatch = latexContent.match(rawDoiRegex);
  if (rawDoiMatch) {
    logger.warn({ example: rawDoiMatch[0] }, "raw_doi_found_in_citation");
  }

  // Check 5: Warn about missing citations (but don't fail - let LaTeX/BibTeX report it)
  if (missingInBib.length > 0) {
    logger.warn(
      {
        missingCitekeys: missingInBib.slice(0, 10),
        total: missingInBib.length,
      },
      "citations_missing_from_bibliography_will_show_as_question_marks",
    );
  }

  // If any errors, throw
  if (errors.length > 0) {
    const errorMessage =
      "Citation validation failed:\n" +
      errors.map((e, i) => `${i + 1}. ${e}`).join("\n");
    logger.error(
      { errors, citekeysInMainTex, citekeysInBib },
      "citation_validation_failed",
    );
    throw new Error(errorMessage);
  }

  logger.info(
    {
      totalCitations: citekeysInMainTex.length,
      totalBibEntries: citekeysInBib.length,
    },
    "citation_validation_passed",
  );
}

/**
 * Cleanup temp work directory
 */
function cleanupWorkDir(workDir: string): void {
  try {
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
      logger.info({ workDir }, "temp_dir_cleaned");
    }
  } catch (error) {
    logger.warn({ workDir, error }, "failed_to_cleanup_temp_dir");
  }
}

/**
 * Extract all citekeys from LaTeX \cite commands
 */
function extractCitekeys(latexContent: string): string[] {
  const citekeys: string[] = [];
  const citePattern = /\\cite[pt]?\{([^}]+)\}/g;

  let match;
  while ((match = citePattern.exec(latexContent)) !== null) {
    if (match[1]) {
      const keys = match[1].split(",").map((k) => k.trim());
      citekeys.push(...keys);
    }
  }

  return Array.from(new Set(citekeys)); // Remove duplicates
}

/**
 * Extract citekeys from BibTeX entries (@article{citekey, ...})
 */
function extractCitekeyFromBibTeX(bibContent: string): string[] {
  const citekeys: string[] = [];
  const entryPattern = /@[a-zA-Z]+\{([^,\s]+)/g;

  let match;
  while ((match = entryPattern.exec(bibContent)) !== null) {
    if (match[1]) {
      citekeys.push(match[1]);
    }
  }

  return citekeys;
}

/**
 * Get image media type from filename
 */
function getImageMediaType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}
