/**
 * Continue-research decision phase.
 *
 * Decides whether the iteration should continue autonomously into another
 * one, or stop and hand control back to the user. Runs only when the
 * next-steps phase produced suggestions and we haven't hit the iteration
 * cap; otherwise short-circuits to "stop, ask user".
 *
 * Returns three boolean flags the caller threads back into its loop:
 *   - shouldContinueLoop: outer while-loop control (kept truthy only when
 *     the agent says continue and we have more iterations left).
 *   - isFinal: whether the upcoming reply should be the user-facing final
 *     answer (false when we're continuing).
 *   - willContinue: whether the caller should promote next-step suggestions
 *     and create a continuation message after the reply.
 */

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
