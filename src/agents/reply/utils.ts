import character from "../../character";
import { LLM } from "../../llm/provider";
import type { LLMRequest } from "../../llm/types";
import type { LLMProvider, PlanTask } from "../../types/core";
import logger from "../../utils/logger";
import { chatReplyPrompt, replyPrompt } from "./prompts";

export type ReplyContext = {
  completedTasks: PlanTask[];
  hypothesis?: string;
  nextPlan: PlanTask[];
  keyInsights: string[];
  discoveries: string[];
  methodology?: string;
  currentObjective?: string;
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

  // Build the prompt
  const replyInstruction = replyPrompt
    .replace("{{question}}", question)
    .replace("{{completedTasks}}", completedTasksText)
    .replace("{{hypothesis}}", context.hypothesis || "No hypothesis generated")
    .replace("{{nextPlan}}", nextPlanText)
    .replace("{{keyInsights}}", keyInsightsText)
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

  // Build the prompt
  const replyInstruction = chatReplyPrompt
    .replace("{{question}}", question)
    .replace("{{completedTasks}}", completedTasksText)
    .replace("{{keyInsights}}", keyInsightsText)
    .replace("{{hypothesis}}", context.hypothesis || "No hypothesis generated");

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
      },
      "chat_reply_generated",
    );

    return response.content;
  } catch (error) {
    logger.error({ error }, "chat_reply_generation_failed");
    throw error;
  }
}
