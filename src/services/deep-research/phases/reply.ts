/**
 * Reply phase: generate the user-facing reply for this iteration.
 *
 * Marks the 'reply' activity, calls replyAgent with the session's completed
 * tasks (last 3 levels of plan), persists the reply via markMessageComplete,
 * writes finalResponse to conversation state on final iterations, and
 * notifies the client that the message is ready.
 */

import type { ConversationState, Message, PlanTask, State } from "../../../types/core";
import logger from "../../../utils/logger";

export interface ReplyPhaseInput {
  conversationState: ConversationState;
  state: State;
  currentMessage: Message;
  hypothesis: string;
  isFinal: boolean;
  iterationCount: number;
  iterationStartTime: number;
  sessionStartLevel: number;
  newLevel: number;
  currentObjective: string;
}

export interface ReplyPhaseDeps {
  assertNotCancelled: () => Promise<void>;
  persistConversationActivity: (
    params: {
      level?: number;
      objective?: string;
      phase: "reply";
    },
    options?: { ensureTraceObjective?: string }
  ) => Promise<void>;
  persistConversationState: (options?: { ensureTraceObjective?: string }) => Promise<void>;
  /** Persist the reply onto the message row. */
  markMessageComplete: (
    id: string,
    update: { content: string; response_time: number; summary?: string }
  ) => Promise<{ updated: boolean }>;
  /** Notify clients that the message has updated content. */
  notifyMessageUpdated: () => Promise<void>;
  replyAgent?: (input: {
    conversationState: ConversationState;
    message: Message;
    completedMaxTasks: PlanTask[];
    hypothesis?: string;
    nextPlan: PlanTask[];
    isFinal?: boolean;
  }) => Promise<{ reply: string; summary?: string; start: string; end: string }>;
}

export interface ReplyPhaseResult {
  reply: string;
  summary?: string;
  updated: boolean;
  responseTime: number;
}

export async function runReplyPhase(
  input: ReplyPhaseInput,
  deps: ReplyPhaseDeps
): Promise<ReplyPhaseResult> {
  await deps.assertNotCancelled();
  await deps.persistConversationActivity({
    level: input.newLevel,
    objective: input.conversationState.values.currentObjective || input.currentObjective,
    phase: "reply",
  });

  // Cap the reply context so continuation iterations don't overwhelm the
  // LLM with all prior work. Inlined to keep the phase module independent
  // of utils/deep-research/continuation-utils (whose static db/operations
  // import would eagerly init Supabase during tests).
  const MAX_LEVELS = 2;
  const minLevel = Math.max(input.sessionStartLevel, input.newLevel - (MAX_LEVELS - 1));
  const plan = input.conversationState.values.plan || [];
  const sessionCompletedTasks = plan.filter(
    (t) => (t.level ?? 0) >= minLevel && t.output && t.output.length > 0
  );

  logger.info(
    {
      newLevel: input.newLevel,
      sessionCompletedTasksCount: sessionCompletedTasks.length,
      sessionStartLevel: input.sessionStartLevel,
      totalPlanTasks: (input.conversationState.values.plan || []).length,
    },
    "reply_tasks_filtered"
  );

  const replyAgent = deps.replyAgent ?? (await import("../../../agents/reply")).replyAgent;

  const replyResult = await replyAgent({
    completedMaxTasks: sessionCompletedTasks,
    conversationState: input.conversationState,
    hypothesis: input.hypothesis,
    isFinal: input.isFinal,
    message: input.currentMessage,
    nextPlan: input.conversationState.values.suggestedNextSteps || [],
  });
  await deps.assertNotCancelled();

  const responseTime = Date.now() - input.iterationStartTime;
  const { updated } = await deps.markMessageComplete(input.currentMessage.id!, {
    content: replyResult.reply,
    response_time: responseTime,
    summary: replyResult.summary,
  });

  if (!updated) {
    logger.warn(
      { iterationCount: input.iterationCount, messageId: input.currentMessage.id },
      "deep_research_iteration_complete_skipped_row_not_pending"
    );
  }

  logger.info(
    {
      contentLength: replyResult.reply.length,
      iterationCount: input.iterationCount,
      messageId: input.currentMessage.id,
    },
    "iteration_reply_saved"
  );

  if (input.isFinal) {
    input.conversationState.values.finalResponse = replyResult.reply;
    if (input.conversationState.id) {
      await deps.persistConversationState();
    }
  }

  await deps.notifyMessageUpdated();

  return {
    reply: replyResult.reply,
    responseTime,
    summary: replyResult.summary,
    updated,
  };
}
