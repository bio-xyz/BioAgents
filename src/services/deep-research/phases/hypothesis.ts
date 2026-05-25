import type { ConversationState, Message, PlanTask } from "../../../types/core";
import logger from "../../../utils/logger";

export interface HypothesisPhaseInput {
  completedTasks: PlanTask[];
  conversationState: ConversationState;
  message: Message;
  objective: string;
}

export interface HypothesisPhaseDeps {
  assertNotCancelled: () => Promise<void>;
  persistConversationState: () => Promise<void>;
  /**
   * Optional override — default dynamically imports the real agent. Tests
   * inject a deterministic stub.
   */
  hypothesisAgent?: (input: {
    completedTasks: PlanTask[];
    conversationState: ConversationState;
    message: Message;
    objective: string;
  }) => Promise<{ hypothesis: string; mode: "create" | "update"; start: string; end: string }>;
}

export interface HypothesisPhaseResult {
  hypothesis: string;
  mode: "create" | "update";
}

export async function runHypothesisPhase(
  input: HypothesisPhaseInput,
  deps: HypothesisPhaseDeps
): Promise<HypothesisPhaseResult> {
  await deps.assertNotCancelled();
  logger.info("generating_hypothesis_from_completed_tasks");

  const hypothesisAgent =
    deps.hypothesisAgent ?? (await import("../../../agents/hypothesis")).hypothesisAgent;

  const result = await hypothesisAgent({
    completedTasks: input.completedTasks,
    conversationState: input.conversationState,
    message: input.message,
    objective: input.objective,
  });

  input.conversationState.values.currentHypothesis = result.hypothesis;
  if (input.conversationState.id) {
    await deps.persistConversationState();
    logger.info(
      { hypothesis: result.hypothesis, mode: result.mode },
      "hypothesis_updated_in_state"
    );
  }

  return { hypothesis: result.hypothesis, mode: result.mode };
}
