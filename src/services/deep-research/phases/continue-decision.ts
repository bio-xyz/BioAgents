// Short-circuits to "stop, ask user" when no suggestions exist or the
// iteration cap was reached; otherwise consults continueResearchAgent.
import type { ConversationState, Message, PlanTask } from "../../../types/core";

export interface ContinueDecisionPhaseInput {
  conversationState: ConversationState;
  message: Message;
  completedTasks: PlanTask[];
  hypothesis: string;
  iterationCount: number;
  maxAutoIterations: number;
  researchMode: "semi-autonomous" | "fully-autonomous" | "steering";
  /** Whether the caller's outer loop was still alive coming in. */
  loopAlive: boolean;
}

export interface ContinueDecisionPhaseDeps {
  assertNotCancelled: () => Promise<void>;
  continueResearchAgent?: (input: {
    conversationState: ConversationState;
    message: Message;
    completedTasks: PlanTask[];
    hypothesis: string;
    suggestedNextSteps: PlanTask[];
    iterationCount: number;
    researchMode: "semi-autonomous" | "fully-autonomous" | "steering";
  }) => Promise<{
    shouldContinue: boolean;
    reasoning: string;
    confidence: "high" | "medium" | "low";
    triggerReason?: string;
  }>;
}

export interface ContinueDecisionPhaseResult {
  shouldContinueLoop: boolean;
  isFinal: boolean;
  willContinue: boolean;
}

export async function runContinueDecisionPhase(
  input: ContinueDecisionPhaseInput,
  deps: ContinueDecisionPhaseDeps
): Promise<ContinueDecisionPhaseResult> {
  const suggested = input.conversationState.values.suggestedNextSteps ?? [];

  // Short-circuit: no suggestions, hit cap, or loop already stopped.
  if (
    !input.loopAlive ||
    suggested.length === 0 ||
    input.iterationCount >= input.maxAutoIterations
  ) {
    return { isFinal: true, shouldContinueLoop: false, willContinue: false };
  }

  await deps.assertNotCancelled();

  const continueResearchAgent =
    deps.continueResearchAgent ??
    (await import("../../../agents/continueResearch")).continueResearchAgent;

  const result = await continueResearchAgent({
    completedTasks: input.completedTasks,
    conversationState: input.conversationState,
    hypothesis: input.hypothesis,
    iterationCount: input.iterationCount,
    message: input.message,
    researchMode: input.researchMode,
    suggestedNextSteps: suggested,
  });

  if (result.shouldContinue) {
    return { isFinal: false, shouldContinueLoop: true, willContinue: true };
  }
  return { isFinal: true, shouldContinueLoop: false, willContinue: false };
}
