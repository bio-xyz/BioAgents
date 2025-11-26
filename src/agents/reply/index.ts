import type {
  ConversationState,
  Message,
  PlanTask,
} from "../../types/core";
import logger from "../../utils/logger";
import { generateReply } from "./utils";

type ReplyResult = {
  reply: string;
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
  hypothesis: string;
  nextPlan: PlanTask[];
}): Promise<ReplyResult> {
  const {
    conversationState,
    message,
    completedMaxTasks,
    hypothesis,
    nextPlan,
  } = input;
  const start = new Date().toISOString();

  logger.info(
    {
      completedTaskCount: completedMaxTasks.length,
      hasHypothesis: !!hypothesis,
      nextPlanCount: nextPlan.length,
      hasInsights: (conversationState.values.keyInsights?.length || 0) > 0,
      hasDiscoveries: (conversationState.values.discoveries?.length || 0) > 0,
    },
    "reply_agent_started",
  );

  try {
    // Generate reply
    const reply = await generateReply(
      message.question || conversationState.values.objective || "",
      {
        completedTasks: completedMaxTasks,
        hypothesis,
        nextPlan,
        keyInsights: conversationState.values.keyInsights || [],
        discoveries: conversationState.values.discoveries || [],
        methodology: conversationState.values.methodology,
        currentObjective: conversationState.values.currentObjective,
      },
      {
        maxTokens: 2000,
        thinking: true,
        thinkingBudget: 1024,
      },
    );

    const end = new Date().toISOString();

    logger.info(
      {
        replyLength: reply.length,
        completedTaskCount: completedMaxTasks.length,
        nextPlanCount: nextPlan.length,
      },
      "reply_agent_completed",
    );

    return {
      reply,
      start,
      end,
    };
  } catch (err) {
    logger.error({ err }, "reply_agent_failed");
    throw err;
  }
}
