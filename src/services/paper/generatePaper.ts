/**
 * Main paper generation service (Markdown → Pandoc → LaTeX → PDF pipeline)
 *
 * Pipeline:
 * 1. Collect DOIs → fetch BibTeX → refs.bib
 * 2. LLM generates Markdown with [@key] citations
 * 3. Assemble full Markdown document with YAML frontmatter
 * 4. Validate Markdown (citation keys, math balance)
 * 5. Pandoc converts Markdown → LaTeX (.tex)
 * 6. XeLaTeX + BibTeX compile → PDF
 * 7. Upload PDF + .tex to storage
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
import { fetchAndWriteBibtex } from "./bib/fetchBibtex";
import { extractCitationKeys } from "./bib/extractKeys";
import type { CitationKeyInfo } from "./bib/extractKeys";
import { pandocConvert } from "./convert/pandocConvert";
import { assembleMarkdown } from "./markdown/assembleMarkdown";
import { validateMarkdown } from "./markdown/validateMarkdown";
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
import { compileLatexToPDF, extractLastLines } from "./utils/compile";
import {
  extractReferences,
  deduplicateRefs,
} from "./bib/extractRefs";
import type { ExtractedRef } from "./bib/extractRefs";

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

  // --- 1. Validate & authenticate ---
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
  const isRealEmail =
    userEmail &&
    !userEmail.endsWith("@x402.local") &&
    !userEmail.endsWith("@temp.local") &&
    userEmail.includes("@");

  const agentName = process.env.AGENT_NAME;
  const agentEmail = process.env.AGENT_EMAIL;
  const agentAuthor = agentName
    ? (agentEmail ? `${agentName} (${agentEmail})` : agentName)
    : null;

  let authors: string;
  if (isRealEmail && agentAuthor) {
    authors = `${userEmail} and ${agentAuthor}`;
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

  // --- 2. Setup workspace ---
  const paperId = existingPaperId || randomUUID();
  const pdfPath = `user/${userId}/conversation/${conversationId}/papers/${paperId}/paper.pdf`;

  if (!existingPaperId) {
    const { error: insertError } = await supabase.from("paper").insert({
      id: paperId,
      user_id: userId,
      conversation_id: conversationId,
      pdf_path: pdfPath,
      status: "processing",
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
    // --- 3. Index tasks & map discoveries ---
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

    // --- 4. Collect all references (DOIs + URLs) from evidence tasks ---
    await onProgress?.("bibliography");

    const allRefs: ExtractedRef[] = [];
    for (const task of evidenceTasks) {
      if (task.output) {
        allRefs.push(...extractReferences(task.output));
      }
    }
    const uniqueRefs = deduplicateRefs(allRefs);

    logger.info(
      {
        totalRefs: uniqueRefs.length,
        doiCount: uniqueRefs.filter((r) => r.type === "doi").length,
        urlCount: uniqueRefs.filter((r) => r.type !== "doi").length,
      },
      "collected_refs_from_evidence",
    );

    // --- 5. Fetch BibTeX → refs.bib ---
    const bibPath = path.join(latexDir, "refs.bib");
    const { entries: bibEntries } = await fetchAndWriteBibtex(
      uniqueRefs,
      bibPath,
    );

    // --- 6. Extract citation keys from entries ---
    const availableKeys = extractCitationKeys(bibEntries);
    const knownKeySet = new Set(bibEntries.map((e) => e.citekey));

    logger.info(
      { keyCount: availableKeys.length },
      "citation_keys_extracted",
    );

    // --- 7. LLM Call 1: Front matter ---
    await onProgress?.("metadata");

    const metadata = await generatePaperMetadata(
      state,
      evidenceTasks,
      authors,
      availableKeys,
      paperId,
    );

    // --- 8. Download figures ---
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

    // --- 9 & 10. LLM Calls: Background + Discovery sections ---
    await onProgress?.("discoveries");

    const discoverySections = await generateDiscoverySectionsParallel(
      discoveryContexts,
      allFigures,
      figuresDir,
      availableKeys,
      3,
      paperId,
    );

    // --- 11. Assemble Markdown document ---
    await onProgress?.("latex_assembly");

    const mdPath = assembleMarkdown({
      title: metadata.title,
      authors: metadata.authors,
      abstract: metadata.abstract,
      researchSnapshot: metadata.researchSnapshot,
      background: metadata.background,
      discoverySections,
      keyInsights: metadata.keyInsights,
      summaryOfDiscoveries: metadata.summaryOfDiscoveries,
      bibFilename: "refs.bib",
      outputDir: latexDir,
    });

    // --- 12. Validate Markdown ---
    // Build URL→citekey map so raw URL citations can be replaced with [@key]
    const urlToCitekey = new Map<string, string>();
    for (const entry of bibEntries) {
      if (entry.url) {
        urlToCitekey.set(entry.url, entry.citekey);
      }
    }
    // Also map DOI URLs
    for (const ref of uniqueRefs) {
      if (ref.type === "doi") {
        const matchingEntry = bibEntries.find((e) => e.doi && e.doi === ref.id);
        if (matchingEntry) {
          urlToCitekey.set(ref.url, matchingEntry.citekey);
          // Also map the raw DOI URL variant
          urlToCitekey.set(`https://doi.org/${ref.id}`, matchingEntry.citekey);
        }
      }
    }

    let mdContent = fs.readFileSync(mdPath, "utf-8");
    mdContent = validateMarkdown(mdContent, knownKeySet, urlToCitekey);
    fs.writeFileSync(mdPath, mdContent, "utf-8");

    // --- 13. Pandoc convert → .tex ---
    const texPath = await pandocConvert(mdPath, bibPath, latexDir);

    logger.info({ texPath }, "pandoc_produced_tex");

    // --- 14. Compile LaTeX → PDF ---
    await onProgress?.("compilation");

    logger.info("compiling_latex");
    const compileResult = await compileLatexToPDF(workDir);

    if (!compileResult.success || !compileResult.pdfPath) {
      const errorLogs = extractLastLines(compileResult.logs, 200);
      logger.error({ errorLogs }, "latex_compilation_failed");

      if (!existingPaperId) {
        await supabase.from("paper").delete().eq("id", paperId);
      }
      throw new Error(`LaTeX compilation failed:\n${errorLogs}`);
    }

    // --- 15. Upload & return ---
    await onProgress?.("upload");

    const storage = getStorageProvider();
    if (!storage) {
      throw new Error("Storage provider not available");
    }

    const pdfBuffer = fs.readFileSync(compileResult.pdfPath);
    await storage.upload(pdfPath, pdfBuffer, "application/pdf");

    const mainTexContent = fs.readFileSync(texPath, "utf-8");
    const rawLatexPath = `user/${userId}/conversation/${conversationId}/papers/${paperId}/main.tex`;
    const rawLatexBuffer = Buffer.from(mainTexContent, "utf-8");
    await storage.upload(rawLatexPath, rawLatexBuffer, "text/plain");

    const pdfUrl = await storage.getPresignedUrl(pdfPath, 3600);
    const rawLatexUrl = await storage.getPresignedUrl(rawLatexPath, 3600);

    // --- Cleanup ---
    await onProgress?.("cleanup");

    cleanupWorkDir(workDir);

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
    cleanupWorkDir(workDir);

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

// ─── Helper functions ─────────────────────────────────────────────────────────

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

  const allTasks = state.plan || [];

  return state.discoveries.map((discovery, index) => {
    let allJobIds: string[] = [];
    let hasInvalidJobIds = false;

    if (discovery.evidenceArray && discovery.evidenceArray.length > 0) {
      allJobIds = discovery.evidenceArray.map((ev) => ev.jobId || ev.taskId);
      hasInvalidJobIds = allJobIds.some((id) => !isValidJobId(id));
      allJobIds = allJobIds.filter(isValidJobId);
    }

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

    if (hasInvalidJobIds) {
      logger.warn(
        { discoveryIndex: index + 1, validJobIds: allJobIds },
        "discovery_has_invalid_job_ids_including_all_tasks",
      );
      const taskIds = new Set(allowedTasks.map((t) => t.jobId || t.id));
      for (const task of allTasks) {
        if (!taskIds.has(task.jobId) && !taskIds.has(task.id)) {
          allowedTasks.push(task);
        }
      }
    }

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
 * Generate paper metadata (LLM calls for title/abstract/background/snapshot)
 */
async function generatePaperMetadata(
  state: ConversationStateValues,
  evidenceTasks: PlanTask[],
  authors: string,
  availableKeys: CitationKeyInfo[],
  paperId?: string,
): Promise<PaperMetadata> {
  logger.info("generating_paper_front_matter");

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

  // Generate front matter (title, abstract, snapshot) — retry once on parse failure
  const frontMatterPrompt = generateFrontMatterPrompt(state);
  const frontMatterParsed = await callLLMWithRetry<{
    title?: string;
    abstract?: string;
    researchSnapshot?: string;
  }>(
    llm,
    frontMatterPrompt,
    LLM_MODEL,
    3000,
    "front matter",
    (parsed) => !!(parsed.title && parsed.abstract && parsed.researchSnapshot),
    paperId,
  );

  if (
    !frontMatterParsed.title ||
    !frontMatterParsed.abstract ||
    !frontMatterParsed.researchSnapshot
  ) {
    throw new Error(
      `Missing fields in front matter response. Keys found: ${Object.keys(frontMatterParsed).join(", ")}`,
    );
  }

  // Generate background section (with citations) — retry once on parse failure
  logger.info("generating_background_section");
  const backgroundPrompt = generateBackgroundPrompt(
    state,
    evidenceTasks,
    availableKeys,
  );
  const backgroundParsed = await callLLMWithRetry<{
    background?: string;
  }>(
    llm,
    backgroundPrompt,
    LLM_MODEL,
    5000,
    "background",
    (parsed) => !!parsed.background,
    paperId,
  );

  if (!backgroundParsed.background) {
    throw new Error(
      `Missing background field in response. Keys found: ${Object.keys(backgroundParsed).join(", ")}`,
    );
  }

  // Build deterministic sections
  const keyInsights = state.keyInsights || [];

  const summaryItems =
    state.discoveries?.map((d, i) => {
      const discoveryTitle = d.title || `Discovery ${i + 1}`;
      return `**Discovery ${i + 1} - ${discoveryTitle}:** ${d.claim}`;
    }) || [];
  const summaryOfDiscoveries = summaryItems.join("\n\n");

  logger.info("paper_front_matter_generated");

  return {
    title: frontMatterParsed.title,
    authors,
    abstract: frontMatterParsed.abstract,
    background: backgroundParsed.background,
    researchSnapshot: frontMatterParsed.researchSnapshot,
    keyInsights,
    summaryOfDiscoveries,
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
  availableKeys: CitationKeyInfo[],
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
          availableKeys,
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
  availableKeys: CitationKeyInfo[],
  paperId?: string,
): Promise<DiscoverySection> {
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
    availableKeys,
  );

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
        const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
        const MAX_IMAGES_PER_REQUEST = 100;

        const contentBlocks: any[] = [];
        const figureSizes: Array<{ filename: string; sizeKB: number }> = [];
        const skippedFigures: Array<{ filename: string; reason: string }> = [];
        let totalImageSizeBytes = 0;
        let imageCount = 0;

        for (const figure of figures) {
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

      const parsed = JSON.parse(jsonMatch[0]) as {
        sectionMarkdown?: string;
        usedDois?: string[];
      };

      if (!parsed.sectionMarkdown) {
        throw new Error(
          `Missing sectionMarkdown in response. Keys found: ${Object.keys(parsed).join(", ")}`,
        );
      }

      return {
        discoveryIndex,
        sectionMarkdown: parsed.sectionMarkdown,
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

      prompt +=
        "\n\nThe previous response was invalid. Return ONLY valid JSON with sectionMarkdown and usedDois fields. No markdown code blocks.";
    }
  }

  throw new Error("Unreachable");
}

/**
 * Call LLM and parse JSON response, retrying once on parse failure.
 */
async function callLLMWithRetry<T extends Record<string, any>>(
  llm: InstanceType<typeof LLM>,
  prompt: string,
  model: string,
  maxTokens: number,
  label: string,
  validate: (parsed: T) => boolean,
  paperId?: string,
  maxAttempts = 2,
): Promise<T> {
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await llm.createChatCompletion({
      messages: [{ role: "user", content: currentPrompt }],
      model,
      temperature: 0.3,
      maxTokens,
      paperId,
      usageType: "paper-generation",
    });

    const content = response.content || "";

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(
          `No JSON found in LLM response for ${label}. Content preview: ${content.substring(0, 300)}`,
        );
      }

      const parsed = JSON.parse(jsonMatch[0]) as T;

      if (!validate(parsed)) {
        throw new Error(
          `Invalid ${label} response. Keys found: ${Object.keys(parsed).join(", ")}`,
        );
      }

      return parsed;
    } catch (error) {
      logger.warn(
        { attempt, label, error: error instanceof Error ? error.message : String(error) },
        "llm_json_parse_failed",
      );

      if (attempt >= maxAttempts) throw error;

      currentPrompt =
        prompt +
        "\n\nThe previous response was invalid. Return ONLY valid JSON with no markdown code blocks or extra text.";
    }
  }

  throw new Error("Unreachable");
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
