/**
 * Next-steps phase: plan the NEXT iteration (planningAgent in "next" mode).
 *
 * Clears any previous suggestions, marks the next_steps activity, runs the
 * planning agent in "next" mode, and stores the returned tasks as
 * conversationState.values.suggestedNextSteps. If the agent returns no
 * tasks, the orchestrator interprets that as "research complete" — the
 * outer loop reads `hasSuggestions === false` and exits.
 */

import type {
  ConversationState,
  ConversationStateValues,
  Message,
  PlanTask,
  State,
} from "../../../types/core";
import type { setDeepResearchActivity } from "../../../utils/deep-research/activity";
import logger from "../../../utils/logger";

export interface NextStepsPhaseInput {
  conversationState: ConversationState;
  message: Message;
  state: State;
  currentObjective: string;
  researchMode: "semi-autonomous" | "fully-autonomous" | "steering";
  newLevel: number;
}

export interface NextStepsPhaseDeps {
  assertNotCancelled: () => Promise<void>;
  persistConversationActivity: (
    params: Parameters<typeof setDeepResearchActivity>[1],
    options?: { ensureTraceObjective?: string; notify?: boolean }
  ) => Promise<void>;
  persistConversationState: (options?: { ensureTraceObjective?: string }) => Promise<void>;
  getObjectiveTraceObjective: (
    values: ConversationStateValues,
    fallback?: string
  ) => string | undefined;
  planningAgent?: (input: {
    state: State;
    conversationState: ConversationState;
    message: Message;
    mode: "initial" | "next";
    researchMode: "semi-autonomous" | "fully-autonomous" | "steering";
    usageType: "deep-research" | "chat" | "paper-generation";
  }) => Promise<{ currentObjective: string; plan: PlanTask[] }>;
}

export interface NextStepsPhaseResult {
  hasSuggestions: boolean;
  suggestedNextSteps: PlanTask[];
  nextObjective?: string;
}

export async function runNextStepsPhase(
  input: NextStepsPhaseInput,
  deps: NextStepsPhaseDeps
): Promise<NextStepsPhaseResult> {
  await deps.assertNotCancelled();
  logger.info("running_next_planning_for_future_iteration");

  // Clear stale suggestions so an empty agent response doesn't leave old
  // tasks behind.
  input.conversationState.values.suggestedNextSteps = [];

  await deps.persistConversationActivity({
    level: input.newLevel,
    objective: input.conversationState.values.currentObjective || input.currentObjective,
    phase: "next_steps",
  });

  const planningAgent =
    deps.planningAgent ?? (await import("../../../agents/planning")).planningAgent;

  const result = await planningAgent({
    conversationState: input.conversationState,
    message: input.message,
    mode: "next",
    researchMode: input.researchMode,
    state: input.state,
    usageType: "deep-research",
  });

  if (result.plan.length === 0) {
    logger.info("no_next_iteration_tasks_suggested_research_complete_or_awaiting_feedback");
    return { hasSuggestions: false, suggestedNextSteps: [] };
  }

  // Store suggestions for next iteration; level + IDs are assigned when (and
  // if) the suggestions are promoted at continuation time.
  input.conversationState.values.suggestedNextSteps = result.plan;
  if (result.currentObjective) {
    input.conversationState.values.currentObjective = result.currentObjective;
  }

  if (input.conversationState.id) {
    await deps.persistConversationState({
      ensureTraceObjective: deps.getObjectiveTraceObjective(
        input.conversationState.values,
        result.currentObjective || input.currentObjective
      ),
    });
    logger.info(
      {
        nextObjective: result.currentObjective,
        nextPlanningSteps: result.plan.map(
          (t) =>
            `${t.type} task: ${t.objective} datasets: ${t.datasets
              .map((d) => `${d.filename} (${d.description})`)
              .join(", ")}`
        ),
      },
      "next_iteration_suggestions_saved"
    );
  }

  return {
    hasSuggestions: true,
    nextObjective: result.currentObjective,
    suggestedNextSteps: result.plan,
  };
}
