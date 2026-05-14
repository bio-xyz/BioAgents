/**
 * Continuation-prep phase: promote suggestedNextSteps to plan + create the
 * agent-only message that the next iteration writes to.
 *
 * Runs only when continue-decision returned willContinue=true. Mutates plan,
 * suggestedNextSteps, currentLevel; persists with the next-iteration
 * planning activity marker; creates a new message row chained from the
 * current one. Caller decides scheduling: the route uses the returned
 * message as the next iteration's currentMessage; the worker enqueues a new
 * BullMQ job pointed at the returned message id.
 */

import type {
  ConversationState,
  ConversationStateValues,
  Message,
  PlanTask,
} from "../../../types/core";
import logger from "../../../utils/logger";
import { applySourceSelectionToPromotedTasks } from "../../../utils/sourceSelectionRouting";

export interface ContinuationPrepPhaseInput {
  conversationState: ConversationState;
  currentMessage: Message;
  /** State row id — passed through to createContinuationMessage. */
  stateId: string;
  /** Plain-text user prompt used for source-selection routing on promoted tasks. */
  userMessage: string;
  currentObjective: string;
}

export interface ContinuationPrepPhaseDeps {
  assertNotCancelled: () => Promise<void>;
  persistConversationActivity: (
    params: {
      level?: number;
      objective?: string;
      phase: "planning";
    },
    options?: { ensureTraceObjective?: string; notify?: boolean }
  ) => Promise<void>;
  getObjectiveTraceObjective: (
    values: ConversationStateValues,
    fallback?: string
  ) => string | undefined;
  createContinuationMessage?: (currentMessage: Message, stateId: string) => Promise<Message>;
}

export interface ContinuationPrepPhaseResult {
  /** The new agent-only message the next iteration writes to. */
  newMessage: Message;
  /** Level assigned to the promoted tasks. */
  nextLevel: number;
  promotedTasks: PlanTask[];
}

export async function runContinuationPrepPhase(
  input: ContinuationPrepPhaseInput,
  deps: ContinuationPrepPhaseDeps
): Promise<ContinuationPrepPhaseResult> {
  await deps.assertNotCancelled();

  const currentPlan = input.conversationState.values.plan || [];
  const currentMaxLevel =
    currentPlan.length > 0 ? Math.max(...currentPlan.map((t) => t.level || 0)) : -1;
  const nextLevel = currentMaxLevel + 1;

  const promotedTasks = applySourceSelectionToPromotedTasks({
    sourceSelectionId: input.conversationState.values.sourceSelectionId,
    tasks: (input.conversationState.values.suggestedNextSteps ?? []).map((task) => {
      const taskId = task.type === "ANALYSIS" ? `ana-${nextLevel}` : `lit-${nextLevel}`;
      return {
        ...task,
        end: undefined,
        id: taskId,
        level: nextLevel,
        output: undefined,
        start: undefined,
      };
    }),
    userMessage: input.userMessage,
  });

  input.conversationState.values.plan = [...currentPlan, ...promotedTasks];
  input.conversationState.values.suggestedNextSteps = [];
  input.conversationState.values.currentLevel = nextLevel;

  if (input.conversationState.id) {
    await deps.persistConversationActivity(
      {
        level: nextLevel,
        objective:
          promotedTasks[0]?.objective ||
          input.conversationState.values.currentObjective ||
          input.currentObjective,
        phase: "planning",
      },
      {
        ensureTraceObjective: deps.getObjectiveTraceObjective(
          input.conversationState.values,
          input.conversationState.values.currentObjective || input.currentObjective
        ),
        notify: true,
      }
    );
    logger.info(
      { nextLevel, promotedTaskCount: promotedTasks.length },
      "suggested_steps_promoted_to_plan"
    );
  }

  // Dynamic import keeps the phase module independent of
  // utils/deep-research/continuation-utils, which transitively eager-loads
  // db/operations + the Supabase client.
  const createContinuationMessage =
    deps.createContinuationMessage ??
    (await import("../../../utils/deep-research/continuation-utils")).createContinuationMessage;

  const newMessage = await createContinuationMessage(input.currentMessage, input.stateId);

  logger.info(
    {
      newMessageId: newMessage.id,
      previousMessageId: input.currentMessage.id,
    },
    "created_agent_continuation_message"
  );

  return { newMessage, nextLevel, promotedTasks };
}
