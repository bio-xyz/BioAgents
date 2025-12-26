/**
 * Main paper generation service
 *
 * Generates a LaTeX paper from a Deep Research conversation state,
 * compiles it to PDF, and uploads to storage.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getConversation, getConversationState } from "../../db/operations";
import { LLM } from "../../llm/provider";
import { getStorageProvider } from "../../storage";
import type {
  ConversationStateValues,
  Discovery,
  PlanTask,
} from "../../types/core";
import logger from "../../utils/logger";
import {
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
import { escapeLatex, replaceUnicodeInLatex } from "./utils/escapeLatex";
import { processInlineDOICitations } from "./utils/inlineDoiCitations";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

/**
 * Main entry point: Generate paper from conversation
 */
export async function generatePaperFromConversation(
  conversationId: string,
  userId: string,
): Promise<PaperGenerationResult> {
  logger.info({ conversationId, userId }, "paper_generation_started");

  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  if (conversation.user_id !== userId) {
    throw new Error(`User ${userId} does not own conversation ${conversationId}`);
  }

  const conversationStateId = conversation.conversation_state_id;
  if (!conversationStateId) {
    throw new Error(`Conversation ${conversationId} has no conversation_state_id`);
  }

  const stateRecord = await getConversationState(conversationStateId);
  if (!stateRecord) {
    throw new Error(`Conversation state not found: ${conversationStateId}`);
  }

  const state = stateRecord.values as ConversationStateValues;

  const paperId = randomUUID();
  const pdfPath = `papers/${paperId}/paper.pdf`;

  const { error: insertError } = await supabase.from("paper").insert({
    id: paperId,
    user_id: userId,
    conversation_id: conversationId,
    pdf_path: pdfPath,
  });

  if (insertError) {
    logger.error({ insertError }, "failed_to_create_paper_record");
    throw new Error(`Failed to create paper record: ${insertError.message}`);
  }

  logger.info({ paperId }, "paper_record_created");

  const workDir = path.join(os.tmpdir(), "paper", paperId);
  const latexDir = path.join(workDir, "latex");
  const figuresDir = path.join(latexDir, "figures");

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(latexDir, { recursive: true });
  fs.mkdirSync(figuresDir, { recursive: true });

  try {
    const tasksByJobId = indexTasksByJobId(state);
    const discoveryContexts = mapDiscoveriesToTasks(state, tasksByJobId);
    const metadata = await generatePaperMetadata(state);

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

    const discoverySections = await generateDiscoverySectionsParallel(
      discoveryContexts,
      allFigures,
      3,
    );

    let mainTexContent = assembleMainTex(metadata, discoverySections);

    const allDOIs = extractDOICitations(mainTexContent);
    const discoveryBibEntries = await resolveMultipleDOIs(allDOIs);
    logger.info({ resolved: discoveryBibEntries.length, total: allDOIs.length }, "dois_resolved");

    const inlineBibEntries: Array<{ doi: string; citekey: string; bibtex: string }> = [];
    for (const [doi, citekey] of metadata.inlineDOIToCitekey.entries()) {
      const entryPattern = new RegExp(`@\\w+\\{${citekey},[\\s\\S]*?\\n\\}`, "m");
      const match = metadata.inlineBibliography.match(entryPattern);
      if (match) {
        inlineBibEntries.push({ doi, citekey, bibtex: match[0] });
      } else {
        logger.warn({ doi, citekey }, "inline_bibtex_entry_not_found");
      }
    }

    const allBibEntries = [...inlineBibEntries, ...discoveryBibEntries];
    const dedupedBibEntries = deduplicateAndResolveCollisions(allBibEntries);
    const doiToCitekeyMap = new Map(dedupedBibEntries.map((e) => [e.doi, e.citekey]));

    mainTexContent = rewriteLatexCitations(mainTexContent, doiToCitekeyMap);
    fs.writeFileSync(path.join(latexDir, "main.tex"), mainTexContent);

    const mergedBibContent = generateBibTeXFile(dedupedBibEntries);
    fs.writeFileSync(path.join(latexDir, "references.bib"), mergedBibContent);

    const citekeysInMainTex = extractCitekeys(mainTexContent);
    const citekeysInBib = extractCitekeyFromBibTeX(mergedBibContent);
    const missingInBib = citekeysInMainTex.filter((key) => !citekeysInBib.includes(key));

    validateCitations(mainTexContent, citekeysInMainTex, citekeysInBib, missingInBib);

    logger.info("compiling_latex");
    let compileResult = await compileLatexToPDF(workDir);

    if (!compileResult.success || !compileResult.pdfPath) {
      const errorLogs = extractLastLines(compileResult.logs, 200);
      logger.error({ errorLogs }, "latex_compilation_failed");
      await supabase.from("paper").delete().eq("id", paperId);
      throw new Error(`LaTeX compilation failed:\n${errorLogs}`);
    }

    const undefinedCitations = checkForUndefinedCitations(compileResult.logs);
    if (undefinedCitations.length > 0) {
      logger.warn({ undefinedCitations, count: undefinedCitations.length }, "removing_undefined_citations");

      mainTexContent = removeUndefinedCitations(mainTexContent, undefinedCitations);
      fs.writeFileSync(path.join(latexDir, "main.tex"), mainTexContent);

      logger.info("recompiling_latex");
      compileResult = await compileLatexToPDF(workDir);

      if (!compileResult.success || !compileResult.pdfPath) {
        const errorLogs = extractLastLines(compileResult.logs, 200);
        logger.error({ errorLogs }, "latex_recompilation_failed");
        await supabase.from("paper").delete().eq("id", paperId);
        throw new Error(`LaTeX recompilation failed:\n${errorLogs}`);
      }

      const remainingUndefined = checkForUndefinedCitations(compileResult.logs);
      if (remainingUndefined.length > 0) {
        logger.warn({ remainingUndefined }, "citations_still_undefined");
      }
    }

    const storage = getStorageProvider();
    if (!storage) {
      throw new Error("Storage provider not available");
    }

    const pdfBuffer = fs.readFileSync(compileResult.pdfPath);
    await storage.upload(pdfPath, pdfBuffer, "application/pdf");

    const rawLatexPath = `papers/${paperId}/main.tex`;
    const rawLatexBuffer = Buffer.from(mainTexContent, "utf-8");
    await storage.upload(rawLatexPath, rawLatexBuffer, "text/plain");

    const pdfUrl = await storage.getPresignedUrl(pdfPath, 3600);
    const rawLatexUrl = await storage.getPresignedUrl(rawLatexPath, 3600);

    cleanupWorkDir(workDir);

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

    // Delete paper record on error
    await supabase.from("paper").delete().eq("id", paperId);

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
    throw new Error("No discoveries found in conversation state");
  }

  return state.discoveries.map((discovery, index) => {
    let allowedJobIds: string[];

    if (discovery.evidenceArray && discovery.evidenceArray.length > 0) {
      allowedJobIds = discovery.evidenceArray.map(
        (ev) => ev.jobId || ev.taskId,
      );
    } else {
      // Fallback to discovery.jobId
      const jobId = (discovery as any).jobId;
      allowedJobIds = jobId ? [jobId] : [];
    }

    const allowedTasks = allowedJobIds
      .map((jobId) => tasksByJobId.get(jobId))
      .filter((task): task is PlanTask => task !== undefined);

    if (allowedTasks.length === 0) {
      throw new Error(
        `Discovery ${index + 1} has no valid tasks. JobIds: ${allowedJobIds.join(", ")}`,
      );
    }

    return { discovery, index, allowedTasks };
  });
}

/**
 * Generate paper metadata (uses LLM for title/abstract/snapshot, deterministic for rest)
 */
async function generatePaperMetadata(
  state: ConversationStateValues,
): Promise<PaperMetadata> {
  logger.info("generating_paper_front_matter");

  // Use LLM to generate title, abstract, and research snapshot
  const prompt = generateFrontMatterPrompt(state);

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

  const response = await llm.createChatCompletion({
    messages: [{ role: "user", content: prompt }],
    model: LLM_MODEL,
    temperature: 0.3,
    maxTokens: 2000,
  });

  const content = response.content || "";

  // Parse JSON response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `No JSON found in LLM response for front matter. Content preview: ${content.substring(0, 300)}`,
    );
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (!parsed.title || !parsed.abstract || !parsed.researchSnapshot) {
    throw new Error(
      `Missing fields in front matter response. Keys found: ${Object.keys(parsed).join(", ")}`,
    );
  }

  // Clean up Unicode in LLM-generated content
  const title = replaceUnicodeInLatex(parsed.title);
  const abstract = replaceUnicodeInLatex(parsed.abstract);
  const researchSnapshot = replaceUnicodeInLatex(parsed.researchSnapshot);

  // Generate deterministic sections
  const keyInsights = state.keyInsights || [];

  // Summary of Discoveries - formatted as "Discovery 1 - Title: Claim"
  const summaryItems =
    state.discoveries?.map((d, i) => {
      const discoveryTitle = d.title || `Discovery ${i + 1}`;
      const claim = d.claim;
      return `**Discovery ${i + 1} - ${discoveryTitle}:** ${claim}`;
    }) || [];
  const summaryOfDiscoveries = summaryItems.join("\n\n");

  logger.info("paper_front_matter_generated");

  // Escape plain text BEFORE processing DOIs (escape only text, not LaTeX commands)
  const escapedKeyInsights = keyInsights.map(escapeLatex);
  const escapedSummary = escapeLatex(summaryOfDiscoveries);

  // Process inline DOI citations in key insights and summary
  // This will convert (text)[doi] to (text) \cite{doi:10.xxxx/yyyy} format
  const keyInsightsText = escapedKeyInsights.join("\n\n");
  const combinedText = `${keyInsightsText}\n\n${escapedSummary}`;

  const doiResult = await processInlineDOICitations(combinedText);

  // Split back into key insights and summary
  // DO NOT escape again - these now contain LaTeX \cite commands
  const lines = doiResult.updatedText.split("\n\n");
  const processedKeyInsights = lines.slice(0, keyInsights.length);
  const processedSummary = lines.slice(keyInsights.length).join("\n\n");

  return {
    title: escapeLatex(title),
    abstract: escapeLatex(abstract),
    researchSnapshot: escapeLatex(researchSnapshot),
    keyInsights: processedKeyInsights, // Already escaped before DOI processing
    summaryOfDiscoveries: processedSummary, // Already escaped before DOI processing
    inlineBibliography: doiResult.referencesBib,
    inlineDOIToCitekey: doiResult.doiToCitekey, // DOI → author-year citekey mapping
  };
}

/**
 * Generate discovery sections in parallel with concurrency limit
 */
async function generateDiscoverySectionsParallel(
  contexts: Array<{
    discovery: Discovery;
    index: number;
    allowedTasks: PlanTask[];
  }>,
  allFigures: Map<number, FigureInfo[]>,
  maxConcurrency: number,
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
        ),
      ),
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Generate a single discovery section using LLM
 */
async function generateDiscoverySection(
  discovery: Discovery,
  discoveryIndex: number,
  allowedTasks: PlanTask[],
  figures: FigureInfo[],
): Promise<DiscoverySection> {
  // Extract allowed DOIs from task outputs
  const allowedDOIs: string[] = [];
  for (const task of allowedTasks) {
    if (task.output) {
      const dois = extractDOIsFromText(task.output);
      allowedDOIs.push(...dois);
    }
  }

  const uniqueAllowedDOIs = Array.from(new Set(allowedDOIs));

  logger.info(
    {
      discoveryIndex,
      taskCount: allowedTasks.length,
      figureCount: figures.length,
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

  // Use PAPER_GEN_LLM_PROVIDER and PAPER_GEN_LLM_MODEL
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
      const response = await llm.createChatCompletion({
        messages: [{ role: "user", content: prompt }],
        model: LLM_MODEL,
        temperature: 0.3,
        maxTokens: 3000,
      });

      const content = response.content || "";

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(
          `No JSON found in LLM response. Content preview: ${content.substring(0, 300)}`,
        );
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.sectionLatex) {
        throw new Error(
          `Missing sectionLatex in response. Keys found: ${Object.keys(parsed).join(", ")}`,
        );
      }

      // Clean up Unicode characters in the LLM-generated LaTeX
      const cleanedLatex = replaceUnicodeInLatex(parsed.sectionLatex);

      return {
        discoveryIndex,
        sectionLatex: cleanedLatex,
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
  return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{graphicx}
\\usepackage[numbers]{natbib}
\\usepackage{hyperref}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\graphicspath{{figures/}}

\\title{${metadata.title}}
\\author{Aubrai}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
${metadata.abstract}
\\end{abstract}

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
