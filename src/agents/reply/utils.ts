import character from "../../character";
import { LLM } from "../../llm/provider";
import type { LLMRequest } from "../../llm/types";
import type { Discovery, LLMProvider, PlanTask } from "../../types/core";
import logger from "../../utils/logger";
import {
  answerModePrompt,
  chatReplyPrompt,
  replyModeClassifierPrompt,
  reportModePrompt,
} from "./prompts";

export type UploadedDataset = {
  id: string;
  filename: string;
  description: string;
  path?: string;
  content?: string;
};

export type ReplyContext = {
  completedTasks: PlanTask[];
  hypothesis?: string;
  nextPlan: PlanTask[];
  keyInsights: string[];
  discoveries: Discovery[];
  methodology?: string;
  currentObjective?: string;
  uploadedDatasets?: UploadedDataset[];
  // Conversation history for classifier context (handles "continue", "yes", etc.)
  // Passed from replyAgent which fetches it internally
  conversationHistory?: Array<{
    question?: string;
    summary?: string;
    content?: string;
  }>;
};

export type ReplyOptions = {
  model?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  messageId?: string; // For token usage tracking
  usageType?: "chat" | "deep-research" | "paper-generation";
  isFinal?: boolean; // Whether this is the final reply (ask for feedback) or intermediate (research continues)
};

/**
 * Format for conversation history entry
 */
type ConversationHistoryEntry = {
  question?: string;
  summary?: string;
  content?: string;
};

/**
 * Classify whether the user's query is a question (ANSWER mode) or directive (REPORT mode)
 * Uses a fast/cheap LLM call to determine the response style
 * Considers conversation history for context (e.g., "continue" after a question)
 */
async function classifyReplyMode(
  question: string,
  conversationHistory: ConversationHistoryEntry[] = [],
): Promise<"ANSWER" | "REPORT"> {
  const CLASSIFIER_LLM_PROVIDER: LLMProvider =
    (process.env.CLASSIFIER_LLM_PROVIDER as LLMProvider) || "google";
  const classifierModel = process.env.CLASSIFIER_LLM_MODEL || "gemini-2.5-pro";

  const llmApiKey =
    process.env[`${CLASSIFIER_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    logger.warn(
      { provider: CLASSIFIER_LLM_PROVIDER },
      "No API key for classifier, defaulting to REPORT mode",
    );
    return "REPORT";
  }

  const llmProvider = new LLM({
    name: CLASSIFIER_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  // Format conversation history (use summary if available, fallback to truncated content)
  const historyText =
    conversationHistory.length > 0
      ? conversationHistory
          .map((msg) => {
            const parts: string[] = [];
            if (msg.question) {
              parts.push(`User: ${msg.question}`);
            }
            // Use summary if available, otherwise truncate content
            if (msg.summary) {
              parts.push(`Assistant: ${msg.summary}`);
            } else if (msg.content) {
              const truncated =
                msg.content.length > 300
                  ? msg.content.substring(0, 300) + "..."
                  : msg.content;
              parts.push(`Assistant: ${truncated}`);
            }
            return parts.join("\n");
          })
          .join("\n\n")
      : "No previous conversation.";

  const prompt = replyModeClassifierPrompt
    .replace("{{conversationHistory}}", historyText)
    .replace("{{question}}", question);

  try {
    const response = await llmProvider.createChatCompletion({
      model: classifierModel,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 100,
    });

    const result = response.content.trim().toUpperCase();
    const mode = result === "ANSWER" ? "ANSWER" : "REPORT";

    return mode;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        provider: CLASSIFIER_LLM_PROVIDER,
        model: classifierModel,
      },
      "reply_mode_classification_failed",
    );
    // Default to REPORT mode on error
    return "REPORT";
  }
}

/**
 * Generate user-facing reply based on completed work and next plan
 * Uses classifier to determine ANSWER vs REPORT mode
 */
export async function generateReply(
  question: string,
  context: ReplyContext,
  options: ReplyOptions = {},
): Promise<string> {
  const model = process.env.REPLY_LLM_MODEL || "gemini-2.5-pro";

  // 1. Determine reply mode
  // - Intermediate replies (isFinal=false): Always REPORT (progress update)
  // - Final replies (isFinal=true): Use classifier to decide ANSWER vs REPORT
  let mode: "ANSWER" | "REPORT";
  if (options.isFinal === false) {
    mode = "REPORT"; // Intermediate replies are always progress reports
    logger.info(
      { mode: "REPORT", reason: "intermediate_reply" },
      "skipping_classification_for_intermediate",
    );
  } else {
    mode = await classifyReplyMode(question, context.conversationHistory || []);
  }

  // Format completed tasks
  const completedTasksText = context.completedTasks
    .map((task, i) => {
      const output = task.output || "No output available";
      const truncatedOutput =
        output.length > 500 ? `${output.substring(0, 500)}...` : output;
      return `${i + 1}. ${task.type} Task: ${task.objective}\n   Output: ${truncatedOutput}`;
    })
    .join("\n\n");

  // Format next plan
  const nextPlanText =
    context.nextPlan.length > 0
      ? context.nextPlan
          .map((task, i) => {
            const datasetsInfo =
              task.datasets.length > 0
                ? ` (using datasets: ${task.datasets.map((d) => d.filename).join(", ")})`
                : "";
            return `${i + 1}. ${task.type} Task: ${task.objective}${datasetsInfo}`;
          })
          .join("\n")
      : "No further tasks planned. The research may be complete or awaiting your feedback.";

  // Format discoveries
  const discoveriesText =
    context.discoveries.length > 0
      ? context.discoveries
          .map((discovery, i) => {
            const evidenceText = discovery.evidenceArray
              .map((ev) => {
                const jobRef = ev.jobId ? ` (Job ID: ${ev.jobId})` : "";
                return `  - Task ${ev.taskId}${jobRef}: ${ev.explanation}`;
              })
              .join("\n");
            return `${i + 1}. ${discovery.title}
   Claim: ${discovery.claim}
   Summary: ${discovery.summary}
   Evidence:
${evidenceText}${discovery.novelty ? `\n   Novelty: ${discovery.novelty}` : ""}`;
          })
          .join("\n\n")
      : "No formalized scientific discoveries yet. They will appear here as we progress our research.";

  // 2. Select prompt based on mode
  let replyInstruction: string;

  if (mode === "ANSWER") {
    // ANSWER mode - direct answer format with internal fallback
    logger.info({ mode: "ANSWER" }, "using_answer_mode_prompt"); // DEBUG
    replyInstruction = answerModePrompt
      .replace("{{question}}", question)
      .replace("{{discoveries}}", discoveriesText)
      .replace(
        "{{hypothesis}}",
        context.hypothesis || "No hypothesis generated",
      )
      .replace("{{completedTasks}}", completedTasksText)
      .replace("{{nextPlan}}", nextPlanText);
  } else {
    // REPORT mode - structured progress report format
    logger.info({ mode: "REPORT" }, "using_report_mode_prompt"); // DEBUG
    replyInstruction = reportModePrompt
      .replace("{{question}}", question)
      .replace("{{completedTasks}}", completedTasksText)
      .replace(
        "{{hypothesis}}",
        context.hypothesis || "No hypothesis generated",
      )
      .replace("{{nextPlan}}", nextPlanText)
      .replace("{{discoveries}}", discoveriesText)
      .replace("{{methodology}}", context.methodology || "Not specified")
      .replace(
        "{{currentObjective}}",
        context.currentObjective || "Not specified",
      );
  }

  // For intermediate replies (research will auto-continue), don't ask for feedback
  if (options.isFinal === false) {
    replyInstruction += `\n\nIMPORTANT: This is an intermediate reply - the research will automatically continue to the next iteration. Do NOT ask the user for feedback or approval. Instead of ending with "Let me know if you'd like me to proceed...", end with a brief note like:\n\n---\n\n**Continuing research...**`;
  }

  const REPLY_LLM_PROVIDER: LLMProvider =
    (process.env.REPLY_LLM_PROVIDER as LLMProvider) || "google";
  const llmApiKey = process.env[`${REPLY_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(
      `${REPLY_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    name: REPLY_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  const llmRequest: LLMRequest = {
    model,
    messages: [
      {
        role: "user" as const,
        content: replyInstruction,
      },
    ],
    maxTokens: options.maxTokens ?? 5500,
    thinkingBudget: options.thinking
      ? (options.thinkingBudget ?? 1024)
      : undefined,
    systemInstruction: character.system,
    messageId: options.messageId,
    usageType: options.usageType,
  };

  try {
    const response = await llmProvider.createChatCompletion(llmRequest);

    logger.info(
      {
        replyLength: response.content.length,
        completedTaskCount: context.completedTasks.length,
        nextPlanCount: context.nextPlan.length,
        replyMode: mode,
      },
      "reply_generated",
    );

    return response.content;
  } catch (error) {
    logger.error({ error }, "reply_generation_failed");
    throw error;
  }
}

/**
 * Generate concise chat reply without next steps
 * For regular chat (not deep research)
 */
export async function generateChatReply(
  question: string,
  context: ReplyContext,
  options: ReplyOptions = {},
): Promise<string> {
  const model = process.env.REPLY_LLM_MODEL || "gemini-2.5-pro";

  // Format completed tasks with full output (not truncated for chat)
  const completedTasksText = context.completedTasks
    .map((task, i) => {
      const output = task.output || "No output available";
      return `${i + 1}. ${task.type} Task: ${task.objective}\n   Output: ${output}`;
    })
    .join("\n\n");

  // Format key insights
  const keyInsightsText =
    context.keyInsights.length > 0
      ? context.keyInsights
          .map((insight, i) => `${i + 1}. ${insight}`)
          .join("\n")
      : "No key insights available.";

  // Format uploaded datasets with content if available (for chat mode)
  // Files are ordered newest-first, so first file is most recently uploaded
  const uploadedDatasetsText =
    context.uploadedDatasets && context.uploadedDatasets.length > 0
      ? context.uploadedDatasets
          .map((dataset, i) => {
            const recentTag =
              i === 0 ? " [MOST RECENTLY UPLOADED - Focus on this file]" : "";
            let text = `${i + 1}. File: ${dataset.filename}${recentTag}\n   Description: ${dataset.description}`;
            if (dataset.content) {
              // Include content for chat mode (up to 30KB per file)
              const contentPreview = dataset.content.slice(0, 30000);
              text += `\n\n--- File Content ---\n${contentPreview}`;
              if (dataset.content.length > 30000) {
                text += "\n[Content truncated...]";
              }
              text += "\n--- End File Content ---";
            }
            return text;
          })
          .join("\n\n")
      : "No datasets uploaded.";

  // Build the prompt
  const replyInstruction = chatReplyPrompt
    .replace("{{question}}", question)
    .replace("{{completedTasks}}", completedTasksText)
    .replace("{{keyInsights}}", keyInsightsText)
    .replace("{{hypothesis}}", context.hypothesis || "No hypothesis generated")
    .replace("{{uploadedDatasets}}", uploadedDatasetsText);

  const REPLY_LLM_PROVIDER: LLMProvider =
    (process.env.REPLY_LLM_PROVIDER as LLMProvider) || "google";
  const llmApiKey = process.env[`${REPLY_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(
      `${REPLY_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    name: REPLY_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  const llmRequest: LLMRequest = {
    model,
    messages: [
      {
        role: "user" as const,
        content: replyInstruction,
      },
    ],
    maxTokens: options.maxTokens ?? 1000, // Shorter for chat
    thinkingBudget: options.thinking
      ? (options.thinkingBudget ?? 1024) // Minimum required by Anthropic
      : undefined,
    systemInstruction: character.system,
    messageId: options.messageId,
    usageType: options.usageType,
  };

  try {
    const response = await llmProvider.createChatCompletion(llmRequest);

    logger.info(
      {
        replyLength: response.content.length,
        completedTaskCount: context.completedTasks.length,
        hasHypothesis: !!context.hypothesis,
        uploadedDatasetsCount: context.uploadedDatasets?.length || 0,
      },
      "chat_reply_generated",
    );

    return response.content;
  } catch (error) {
    logger.error({ error }, "chat_reply_generation_failed");
    throw error;
  }
}
