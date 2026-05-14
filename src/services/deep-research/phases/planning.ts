/**
 * Planning phase of a single deep-research iteration.
 *
 * Three paths, all of which arrive at a populated plan and a currentObjective:
 *
 * 1. Continuation (skipPlanning=true): tasks were promoted by the previous
 *    iteration's continuation-prep; just read the current max level.
 * 2. Clarification (iteration 1 + clarificationContext.initialTasks): use
 *    pre-approved tasks from the clarification flow, skip the LLM.
 * 3. Default: call planningAgent(mode='initial') to generate tasks.
 *
 * Shared between the route and the worker. Each caller injects its own
 * cancellation checker, persist callback, and (in the worker case) a guard
 * against the clarification path running on continuation jobs.
 */

import type {
  ConversationState,
  ConversationStateValues,
  Message,
  PlanTask,
  PlanTaskType,
  State,
} from "../../../types/core";
import logger from "../../../utils/logger";
import { applySourceSelectionToPromotedTasks } from "../../../utils/sourceSelectionRouting";

export interface PlanningPhaseInput {
  conversationState: ConversationState;
  state: State;
  /** Current iteration's message (may differ from rootMessage on continuations). */
  currentMessage: Message;
  /** Root message (iteration 1's user message) — used for objective fallback. */
  rootMessage: Message;
  researchMode: "semi-autonomous" | "fully-autonomous" | "steering";
  iterationCount: number;
  /** When true, the previous iteration promoted tasks via continuation-prep. */
  skipPlanning: boolean;
}

export interface PlanningPhaseDeps {
  assertNotCancelled: () => Promise<void>;
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

export interface PlanningPhaseResult {
  newLevel: number;
  currentObjective: string;
  /** Always false after this phase — the caller threads it back into its loop. */
  nextSkipPlanning: false;
}

export async function runPlanningPhase(
  input: PlanningPhaseInput,
  deps: PlanningPhaseDeps
): Promise<PlanningPhaseResult> {
  // Path 1: continuation — tasks already promoted; just read the level.
  if (input.skipPlanning) {
    const currentPlan = input.conversationState.values.plan || [];
    const newLevel = currentPlan.length > 0 ? Math.max(...currentPlan.map((t) => t.level || 0)) : 0;
    const currentObjective = input.conversationState.values.currentObjective || "";
    logger.info({ currentObjective, newLevel }, "continuation_using_promoted_tasks");
    return { currentObjective, newLevel, nextSkipPlanning: false };
  }

  // Path 2: clarification tasks — only valid on the very first iteration.
  const clarCtx = input.conversationState.values.clarificationContext;
  if (input.iterationCount === 1 && clarCtx?.initialTasks?.length) {
    return runClarificationPath(input, deps, clarCtx);
  }

  // Path 3: default — run planningAgent in 'initial' mode.
  return runInitialPath(input, deps);
}

async function runClarificationPath(
  input: PlanningPhaseInput,
  deps: PlanningPhaseDeps,
  clarCtx: NonNullable<ConversationStateValues["clarificationContext"]>
): Promise<PlanningPhaseResult> {
  const initialTasks = clarCtx.initialTasks!;
  const uploadedDatasets = input.conversationState.values.uploadedDatasets || [];

  logger.info(
    { taskCount: initialTasks.length, uploadedDatasetCount: uploadedDatasets.length },
    "using_clarification_initial_tasks"
  );

  const currentPlan = input.conversationState.values.plan || [];
  const maxLevel = currentPlan.length > 0 ? Math.max(...currentPlan.map((t) => t.level || 0)) : -1;
  const newLevel = maxLevel + 1;

  const newTasks: PlanTask[] = initialTasks.map((task) => {
    const taskId = task.type === "ANALYSIS" ? `ana-${newLevel}` : `lit-${newLevel}`;
    const resolvedDatasets = (task.datasetFilenames || [])
      .map((filename) => {
        const dataset = uploadedDatasets.find((d) => d.filename === filename);
        if (!dataset) {
          logger.warn(
            { availableDatasets: uploadedDatasets.map((d) => d.filename), filename },
            "clarification_dataset_not_found"
          );
          return null;
        }
        return {
          description: dataset.description,
          filename: dataset.filename,
          id: dataset.id,
          path: dataset.path,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    return {
      datasets: resolvedDatasets,
      end: undefined,
      id: taskId,
      level: newLevel,
      objective: task.objective,
      output: undefined,
      sources: task.sources,
      start: undefined,
      type: task.type as PlanTaskType,
    };
  });

  const tasksWithSourceSelection = applySourceSelectionToPromotedTasks({
    sourceSelectionId: input.conversationState.values.sourceSelectionId,
    tasks: newTasks,
    userMessage: input.currentMessage.question || input.rootMessage.question || "",
  });

  const currentObjective = clarCtx.refinedObjective;

  input.conversationState.values.plan = [...currentPlan, ...tasksWithSourceSelection];
  input.conversationState.values.currentObjective = currentObjective;
  input.conversationState.values.currentLevel = newLevel;
  if (!input.conversationState.values.objective) {
    input.conversationState.values.objective = clarCtx.refinedObjective;
  }
  if (!input.conversationState.values.evolvingObjective) {
    input.conversationState.values.evolvingObjective = clarCtx.refinedObjective;
  }
  input.conversationState.values.clarificationContext = {
    ...clarCtx,
    initialTasks: undefined,
  };

  if (input.conversationState.id) {
    await deps.persistConversationState({
      ensureTraceObjective: deps.getObjectiveTraceObjective(
        input.conversationState.values,
        currentObjective
      ),
    });
    logger.info(
      { currentObjective, newLevel, taskCount: tasksWithSourceSelection.length },
      "clarification_tasks_promoted_to_plan"
    );
  }

  return { currentObjective, newLevel, nextSkipPlanning: false };
}

async function runInitialPath(
  input: PlanningPhaseInput,
  deps: PlanningPhaseDeps
): Promise<PlanningPhaseResult> {
  await deps.assertNotCancelled();
  logger.info(
    { suggestedNextSteps: input.conversationState.values.suggestedNextSteps },
    "current_suggested_next_steps"
  );

  const planningAgent =
    deps.planningAgent ?? (await import("../../../agents/planning")).planningAgent;

  const result = await planningAgent({
    conversationState: input.conversationState,
    message: input.currentMessage,
    mode: "initial",
    researchMode: input.researchMode,
    state: input.state,
    usageType: "deep-research",
  });

  if (!result.plan || !result.currentObjective) {
    throw new Error("Plan or current objective not found");
  }

  input.conversationState.values.suggestedNextSteps = [];

  const currentPlan = input.conversationState.values.plan || [];
  const maxLevel = currentPlan.length > 0 ? Math.max(...currentPlan.map((t) => t.level || 0)) : -1;
  const newLevel = maxLevel + 1;

  const newTasks = result.plan.map((task: PlanTask) => {
    const taskId = task.type === "ANALYSIS" ? `ana-${newLevel}` : `lit-${newLevel}`;
    return {
      ...task,
      end: undefined,
      id: taskId,
      level: newLevel,
      output: undefined,
      start: undefined,
    };
  });

  input.conversationState.values.plan = [...currentPlan, ...newTasks];
  input.conversationState.values.currentObjective = result.currentObjective;
  input.conversationState.values.currentLevel = newLevel;
  if (!input.conversationState.values.objective && input.rootMessage.question) {
    input.conversationState.values.objective = input.rootMessage.question;
  }
  if (!input.conversationState.values.evolvingObjective && input.rootMessage.question) {
    input.conversationState.values.evolvingObjective = input.rootMessage.question;
  }

  if (input.conversationState.id) {
    await deps.persistConversationState({
      ensureTraceObjective: deps.getObjectiveTraceObjective(
        input.conversationState.values,
        result.currentObjective
      ),
    });
    logger.info(
      { newLevel, newObjective: result.currentObjective, newTasks },
      "new_tasks_added_to_plan"
    );
  }

  return {
    currentObjective: result.currentObjective,
    newLevel,
    nextSkipPlanning: false,
  };
}
