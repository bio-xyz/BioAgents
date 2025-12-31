import character from "../../character";
import { LLM } from "../../llm/provider";
import type { LLMRequest } from "../../llm/types";
import type { Discovery, LLMProvider, PlanTask } from "../../types/core";
import logger from "../../utils/logger";
import { chatReplyPrompt, replyPrompt } from "./prompts";

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
};

export type ReplyOptions = {
  model?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
};

/**
 * Generate user-facing reply based on completed work and next plan
 */
export async function generateReply(
  question: string,
  context: ReplyContext,
  options: ReplyOptions = {},
): Promise<string> {
  const model = process.env.REPLY_LLM_MODEL || "gemini-2.5-pro";

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

  // Format key insights
  const keyInsightsText =
    context.keyInsights.length > 0
      ? context.keyInsights
          .map((insight, i) => `${i + 1}. ${insight}`)
          .join("\n")
      : "No key insights yet.";

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

  // Build the prompt
  // Note: uploadedDatasets not included - deep research analyzes files via ANALYSIS tasks
  const replyInstruction = replyPrompt
    .replace("{{question}}", question)
    .replace("{{completedTasks}}", completedTasksText)
    .replace("{{hypothesis}}", context.hypothesis || "No hypothesis generated")
    .replace("{{nextPlan}}", nextPlanText)
    .replace("{{keyInsights}}", keyInsightsText)
    .replace("{{discoveries}}", discoveriesText)
    .replace("{{methodology}}", context.methodology || "Not specified")
    .replace(
      "{{currentObjective}}",
      context.currentObjective || "Not specified",
    );

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
    maxTokens: options.maxTokens ?? 2000,
    thinkingBudget: options.thinking
      ? (options.thinkingBudget ?? 1024)
      : undefined,
    systemInstruction: character.system,
  };

  try {
    const response = await llmProvider.createChatCompletion(llmRequest);

    logger.info(
      {
        replyLength: response.content.length,
        completedTaskCount: context.completedTasks.length,
        nextPlanCount: context.nextPlan.length,
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
            const recentTag = i === 0 ? " [MOST RECENTLY UPLOADED - Focus on this file]" : "";
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
