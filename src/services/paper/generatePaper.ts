/**
 * Main paper generation service
 *
 * Generates a LaTeX paper from a Deep Research conversation state,
 * compiles it to PDF, and uploads to storage.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import archiver from "archiver";
import logger from "../../utils/logger";
import { getStorageProvider } from "../../storage";
import { LLM } from "../../llm/provider";
import {
  getConversation,
  getConversationState,
  type ConversationState,
} from "../../db/operations";
import { createClient } from "@supabase/supabase-js";
import type { ConversationStateValues, PlanTask, Discovery } from "../../types/core";
import type {
  PaperGenerationResult,
  FigureInfo,
  DiscoverySection,
  BibTeXEntry,
  PaperMetadata,
} from "./types";
import { escapeLatex, truncateText, replaceUnicodeInLatex } from "./utils/escapeLatex";
import {
  extractDOICitations,
  normalizeDOI,
  doiToCitekey,
  extractDOIsFromText,
} from "./utils/doi";
import {
  resolveMultipleDOIs,
  generateBibTeXFile,
  rewriteLatexCitations,
  extractCitekeys,
  citekeyExistsInBibTeX,
} from "./utils/bibtex";
import { compileLatexToPDF, extractLastLines } from "./utils/compile";
import { downloadDiscoveryFigures } from "./utils/artifacts";
import {
  generateDiscoverySectionPrompt,
  generateRepairPrompt,
} from "./prompts";

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

  // 1. Load conversation and state
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

  // 2. Create Paper DB record first to get paperId
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

  // 3. Create temp workspace
  const workDir = path.join(os.tmpdir(), "paper", paperId);
  const latexDir = path.join(workDir, "latex");
  const figuresDir = path.join(latexDir, "figures");

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(latexDir, { recursive: true });
  fs.mkdirSync(figuresDir, { recursive: true });

  try {
    // 4. Index plan tasks by jobId
    const tasksByJobId = indexTasksByJobId(state);

    // 5. Map discoveries to tasks
    const discoveryContexts = mapDiscoveriesToTasks(state, tasksByJobId);

    // 6. Write deterministic sections
    const metadata = generatePaperMetadata(state);

    // 7. Download figures for all discoveries
    const allFigures: Map<number, FigureInfo[]> = new Map();
    for (let i = 0; i < discoveryContexts.length; i++) {
      const ctx = discoveryContexts[i];
      const figures = await downloadDiscoveryFigures(
        ctx.allowedTasks,
        i + 1,
        figuresDir,
        userId,
        conversationStateId,
      );
      allFigures.set(i, figures);
    }

    // 8. Generate discovery sections with LLM (parallel, limit concurrency)
    const discoverySections = await generateDiscoverySectionsParallel(
      discoveryContexts,
      allFigures,
      3, // Max concurrency
    );

    // 9. Assemble main.tex
    const mainTexContent = assembleMainTex(metadata, discoverySections);
    fs.writeFileSync(path.join(latexDir, "main.tex"), mainTexContent);

    // 10. Extract DOIs and resolve to BibTeX
    const allDOIs = extractDOICitations(mainTexContent);
    logger.info({ doiCount: allDOIs.length }, "extracting_dois");

    const bibEntries = await resolveMultipleDOIs(allDOIs);
    logger.info(
      { resolved: bibEntries.length, total: allDOIs.length },
      "dois_resolved",
    );

    // 11. Generate references.bib
    const bibContent = generateBibTeXFile(bibEntries);
    fs.writeFileSync(path.join(latexDir, "references.bib"), bibContent);

    // 12. Rewrite citations from doi: to citekeys
    const doiToCitekeyMap = new Map(bibEntries.map((e) => [e.doi, e.citekey]));
    let finalMainTex = rewriteLatexCitations(mainTexContent, doiToCitekeyMap);

    // 13. Check for unresolved DOIs or missing citekeys
    const unresolvedDOIs = allDOIs.filter((doi) => !doiToCitekeyMap.has(doi));
    const usedCitekeys = extractCitekeys(finalMainTex);
    const missingCitekeys = usedCitekeys.filter(
      (ck) => !citekeyExistsInBibTeX(ck, bibEntries),
    );

    // 14. Repair pass if needed
    if (unresolvedDOIs.length > 0 || missingCitekeys.length > 0) {
      logger.warn(
        { unresolvedDOIs, missingCitekeys },
        "running_repair_pass",
      );

      const repairedTex = await repairLatexCitations(
        finalMainTex,
        unresolvedDOIs,
        missingCitekeys,
        bibEntries.map((e) => e.citekey),
        bibEntries.map((e) => e.doi),
      );

      finalMainTex = repairedTex;
      fs.writeFileSync(path.join(latexDir, "main.tex"), finalMainTex);
    } else {
      fs.writeFileSync(path.join(latexDir, "main.tex"), finalMainTex);
    }

    // 15. Compile PDF
    logger.info("compiling_latex_to_pdf");
    const compileResult = await compileLatexToPDF(workDir);

    if (!compileResult.success || !compileResult.pdfPath) {
      const errorLogs = extractLastLines(compileResult.logs, 200);
      logger.error({ errorLogs }, "latex_compilation_failed");

      // Delete paper record on failure
      await supabase.from("paper").delete().eq("id", paperId);

      throw new Error(`LaTeX compilation failed:\n${errorLogs}`);
    }

    // 16. Create source.zip
    const sourceZipPath = path.join(workDir, "source.zip");
    await createSourceZip(latexDir, sourceZipPath);

    // 17. Upload to storage
    const storage = getStorageProvider();
    if (!storage) {
      throw new Error("Storage provider not available");
    }

    // Upload PDF
    const pdfBuffer = fs.readFileSync(compileResult.pdfPath);
    await storage.upload(pdfPath, pdfBuffer, "application/pdf");
    logger.info({ pdfPath }, "pdf_uploaded");

    // Upload source.zip
    const sourceZipBuffer = fs.readFileSync(sourceZipPath);
    const sourceZipKey = `papers/${paperId}/source.zip`;
    await storage.upload(sourceZipKey, sourceZipBuffer, "application/zip");
    logger.info({ sourceZipKey }, "source_zip_uploaded");

    // 18. Generate signed URLs
    const pdfUrl = await storage.getPresignedUrl(pdfPath, 3600);
    const sourceZipUrl = await storage.getPresignedUrl(sourceZipKey, 3600);

    // 19. Cleanup
    cleanupWorkDir(workDir);

    logger.info({ paperId }, "paper_generation_completed");

    return {
      paperId,
      conversationId,
      conversationStateId,
      pdfPath,
      pdfUrl,
      sourceZipUrl,
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
      allowedJobIds = discovery.evidenceArray.map((ev) => ev.jobId || ev.taskId);
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
 * Generate paper metadata (deterministic sections)
 */
function generatePaperMetadata(state: ConversationStateValues): PaperMetadata {
  const objective = state.objective || "Deep Research Objective";

  // Title: shortened objective
  const title =
    objective.length > 80
      ? `Deep Research Discovery Report: ${truncateText(objective, 60)}`
      : `Deep Research Discovery Report: ${objective}`;

  // Key Insights
  const keyInsights = state.keyInsights || [];

  // Research Snapshot
  let researchSnapshot = "";
  if (state.currentObjective) {
    researchSnapshot += `**Current Objective:** ${state.currentObjective}\n\n`;
  }
  if (state.currentHypothesis) {
    researchSnapshot += `**Current Hypothesis:** ${state.currentHypothesis}\n\n`;
  }
  if (state.methodology && state.methodology.length <= 800) {
    researchSnapshot += `**Methodology:** ${state.methodology}\n\n`;
  }

  // Summary of Discoveries
  const summaryItems =
    state.discoveries?.map((d) => {
      const summary = d.summary || d.claim.substring(0, 150);
      return `**${d.claim}** – ${summary}`;
    }) || [];
  const summaryOfDiscoveries = summaryItems.join("\n\n");

  return {
    title: escapeLatex(title),
    objective: escapeLatex(objective),
    keyInsights: keyInsights.map(escapeLatex),
    researchSnapshot: escapeLatex(researchSnapshot),
    summaryOfDiscoveries: escapeLatex(summaryOfDiscoveries),
  };
}

/**
 * Generate discovery sections in parallel with concurrency limit
 */
async function generateDiscoverySectionsParallel(
  contexts: Array<{ discovery: Discovery; index: number; allowedTasks: PlanTask[] }>,
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
    { discoveryIndex, taskCount: allowedTasks.length, figureCount: figures.length },
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
  const apiKey = process.env[`${LLM_PROVIDER.toUpperCase()}_API_KEY`] ||
                 process.env.ANTHROPIC_API_KEY ||
                 process.env.OPENAI_API_KEY || "";

  if (!apiKey) {
    throw new Error(`API key not configured for paper generation LLM provider: ${LLM_PROVIDER}`);
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
        throw new Error(`No JSON found in LLM response. Content preview: ${content.substring(0, 300)}`);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.sectionLatex) {
        throw new Error(`Missing sectionLatex in response. Keys found: ${Object.keys(parsed).join(", ")}`);
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
\\usepackage{natbib}
\\usepackage{hyperref}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\graphicspath{{figures/}}

\\title{${metadata.title}}
\\author{Deep Research Agent}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Research Objective}
${metadata.objective}

\\section{Key Insights}
\\begin{itemize}
${metadata.keyInsights.map((insight) => `\\item ${insight}`).join("\n")}
\\end{itemize}

\\section{Research Snapshot}
${metadata.researchSnapshot}

\\section{Summary of Discoveries}
${metadata.summaryOfDiscoveries}

${discoverySections.map((ds) => ds.sectionLatex).join("\n\n")}

\\bibliographystyle{plainnat}
\\bibliography{references}

\\end{document}
`;
}

/**
 * Repair LaTeX citations using LLM
 */
async function repairLatexCitations(
  mainTexContent: string,
  unresolvedDOIs: string[],
  missingCitekeys: string[],
  availableCitekeys: string[],
  allowedDOIs: string[],
): Promise<string> {
  const prompt = generateRepairPrompt(
    mainTexContent,
    unresolvedDOIs,
    missingCitekeys,
    availableCitekeys,
    allowedDOIs,
  );

  const LLM_PROVIDER = (process.env.PAPER_GEN_LLM_PROVIDER || "openai") as any;
  const LLM_MODEL = process.env.PAPER_GEN_LLM_MODEL || "gpt-4o";
  const apiKey = process.env[`${LLM_PROVIDER.toUpperCase()}_API_KEY`] ||
                 process.env.ANTHROPIC_API_KEY ||
                 process.env.OPENAI_API_KEY || "";

  const llm = new LLM({
    name: LLM_PROVIDER,
    apiKey,
  } as any);

  const response = await llm.createChatCompletion({
    messages: [{ role: "user", content: prompt }],
    model: LLM_MODEL,
    temperature: 0.1,
    maxTokens: 8000,
  });

  return response.content || mainTexContent;
}

/**
 * Create source.zip from latex directory
 */
async function createSourceZip(
  latexDir: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      logger.info({ size: archive.pointer() }, "source_zip_created");
      resolve();
    });

    archive.on("error", (err: Error) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(latexDir, false);
    archive.finalize();
  });
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
