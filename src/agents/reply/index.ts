import type { ConversationState, Message, PlanTask } from "../../types/core";
import {
  fetchConversationHistory,
  resolveQuestionForReply,
} from "../../utils/deep-research/continuation-utils";
import logger from "../../utils/logger";
import { generateReply } from "./utils";

type ReplyResult = {
  reply: string;
  summary?: string; // Extracted summary for conversation history
  start: string;
  end: string;
};

/**
 * Reply agent for deep research
 * Generates a user-facing reply that summarizes the work done and presents the next plan
 *
 * Flow:
 * 1. Take completed MAX level tasks, hypothesis, world state, and next iteration plan
 * 2. Summarize what was done and the results
 * 3. Present the hypothesis
 * 4. Present the plan for next iteration (if any)
 * 5. Ask user for feedback on the plan
 */
export async function replyAgent(input: {
  conversationState: ConversationState;
  message: Message;
  completedMaxTasks: PlanTask[];
  hypothesis?: string;
  nextPlan: PlanTask[];
  isFinal?: boolean; // Whether this is the final reply (ask for feedback) or intermediate (research continues)
}): Promise<ReplyResult> {
  const {
    conversationState,
    message,
    completedMaxTasks,
    hypothesis,
    nextPlan,
    isFinal = true, // Default to final (ask for feedback)
  } = input;
  const start = new Date().toISOString();

  logger.info(
    {
      completedTaskCount: completedMaxTasks.length,
      hasDiscoveries: (conversationState.values.discoveries?.length || 0) > 0,
      hasHypothesis: !!hypothesis,
      hasInsights: (conversationState.values.keyInsights?.length || 0) > 0,
      nextPlanCount: nextPlan.length,
    },
    "reply_agent_started"
  );

  // Fetch conversation history for classifier context (handles "continue", "yes", etc.)
  const conversationHistory = await fetchConversationHistory(message.conversation_id);

  // Resolve question for classification and reply
  // Priority: current message question > first question from history > objective
  const questionForReply = resolveQuestionForReply(
    message.question,
    conversationHistory,
    conversationState.values.objective
  );

  logger.info(
    {
      messageQuestion: message.question?.substring(0, 50) || "EMPTY",
      resolvedQuestion: questionForReply.substring(0, 50),
      source: message.question
        ? "current"
        : conversationHistory.find((h) => h.question)
          ? "history"
          : "objective",
    },
    "reply_agent_question_resolved"
  );

  try {
    // Generate reply
    // Note: uploadedDatasets not passed here - deep research has already analyzed
    // the files via ANALYSIS tasks, results are in completedTasks
    const reply = await generateReply(
      questionForReply,
      {
        completedTasks: completedMaxTasks,
        conversationHistory,
        currentObjective: conversationState.values.currentObjective,
        discoveries: conversationState.values.discoveries || [],
        evolvingObjective: conversationState.values.evolvingObjective,
        hypothesis,
        keyInsights: conversationState.values.keyInsights || [],
        methodology: conversationState.values.methodology,
        nextPlan,
      },
      {
        isFinal,
        maxTokens: 4500,
        messageId: message.id,
        thinking: true,
        thinkingBudget: 1024,
        usageType: "deep-research",
      }
    );

    const end = new Date().toISOString();

    // Extract summary section for conversation history
    const summaryMatch = reply.match(/## Summary\s+([\s\S]+?)(?:\n---|\n##|$)/);
    const summary = summaryMatch ? summaryMatch[1]!.trim() : reply.substring(0, 300) + "..."; // Fallback to first 300 chars

    logger.info(
      {
        completedTaskCount: completedMaxTasks.length,
        nextPlanCount: nextPlan.length,
        replyLength: reply.length,
        summaryLength: summary.length,
      },
      "reply_agent_completed"
    );

    return {
      end,
      reply,
      start,
      summary,
    };
  } catch (err) {
    logger.error({ err }, "reply_agent_failed");
    throw err;
  }
}
