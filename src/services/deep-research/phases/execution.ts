/**
 * Execution phase: fan out literature + analysis tasks for the current level.
 *
 * Each task mutates its row in-place (start/end timestamps, output, jobId,
 * proteinStructures, artifacts, reasoning). State writes are serialized
 * through the caller-supplied write chain so concurrent task callbacks
 * don't clobber each other's mutations.
 *
 * Per task type:
 *   - LITERATURE: fans out OpenScholar, primary (Edison or BioLit), and
 *     Knowledge sub-agents based on env config; appends each result to the
 *     task's output.
 *   - ANALYSIS: calls analysisAgent and captures output + artifacts + jobId,
 *     with a try/catch that writes "Analysis failed: <err>" to the task on
 *     failure so the rest of the iteration can continue.
 *
 * Shared between route + worker. Each transport supplies its own
 * notifyStateUpdated callback and (for the worker) an optional
 * onAnalysisStarted hook so it can emit BullMQ progress before the analysis
 * agent runs.
 */

import type {
  ConversationState,
  OnPollUpdate,
  PlanTask,
  ProteinStructure,
} from "../../../types/core";

import logger from "../../../utils/logger";
import { mergeProteinStructures } from "../../../utils/proteinStructures";

type LiteratureType = "OPENSCHOLAR" | "KNOWLEDGE" | "EDISON" | "BIOLIT" | "BIOLITDEEP";

export interface ExecutionPhaseInput {
  conversationState: ConversationState;
  tasksToExecute: PlanTask[];
  newLevel: number;
  /** Filled in for ANALYSIS tasks — analysisAgent requires userId. */
  userId: string;
}

export interface ExecutionPhaseDeps {
  assertNotCancelled: () => Promise<void>;
  /** Serialised state write — every task callback must funnel through it. */
  writeStateSerialized: () => Promise<unknown>;
  /** Transport-specific notify; called after each visible state change. */
  notifyStateUpdated: () => Promise<void>;
  /** Worker-only hook to emit BullMQ progress before ANALYSIS starts. */
  onAnalysisStarted?: () => Promise<void>;
  literatureAgent?: (input: {
    objective: string;
    type: LiteratureType;
    sources?: string[];
    onJobCreated?: (jobId: string) => Promise<void> | void;
    onPollUpdate?: OnPollUpdate;
  }) => Promise<{
    output: string;
    count?: number;
    jobId?: string;
    proteinStructures?: ProteinStructure[];
  }>;
  analysisAgent?: (input: {
    conversationStateId: string;
    datasets: PlanTask["datasets"];
    objective: string;
    onPollUpdate?: OnPollUpdate;
    type: "EDISON" | "BIO";
    userId: string;
  }) => Promise<{
    output: string;
    artifacts?: PlanTask["artifacts"];
    jobId?: string;
  }>;
}

export async function runExecutionPhase(
  input: ExecutionPhaseInput,
  deps: ExecutionPhaseDeps
): Promise<void> {
  await deps.assertNotCancelled();

  if (input.tasksToExecute.length === 0) {
    logger.info({ newLevel: input.newLevel }, "execution_phase_no_tasks");
    return;
  }

  const hasLiterature = input.tasksToExecute.some((t) => t.type === "LITERATURE");
  const hasAnalysis = input.tasksToExecute.some((t) => t.type === "ANALYSIS");
  // Load each agent only when its task type is present so test callers that
  // exercise one path don't need to stub the other (default dynamic-import
  // would transitively load db/operations and crash without env).
  const literatureAgent = hasLiterature
    ? (deps.literatureAgent ?? (await import("../../../agents/literature")).literatureAgent)
    : (deps.literatureAgent ??
      (async () => {
        throw new Error("literatureAgent not configured");
      }));
  const analysisAgent = hasAnalysis
    ? (deps.analysisAgent ?? (await import("../../../agents/analysis")).analysisAgent)
    : (deps.analysisAgent ??
      (async () => {
        throw new Error("analysisAgent not configured");
      }));
  // Inlined activity setter so the phase module stays independent of
  // utils/deep-research/activity (whose objective-trace import transitively
  // pulls llm/provider + db/operations — heavyweight in tests).
  const ACTIVITY_LABELS: Record<"literature" | "analysis", string> = {
    analysis: "Analyzing data",
    literature: "Researching literature",
  };
  const setDeepResearchActivity = (
    values: ConversationState["values"],
    params: {
      phase: "literature" | "analysis";
      objective?: string;
      level?: number;
      taskType?: PlanTask["type"];
    }
  ) => {
    values.currentActivity = {
      label: ACTIVITY_LABELS[params.phase],
      level: params.level,
      objective: params.objective,
      phase: params.phase,
      taskType: params.taskType,
      updatedAt: new Date().toISOString(),
    };
  };

  const conversationState = input.conversationState;

  const taskPromises = input.tasksToExecute.map(async (task) => {
    // Reasoning traces flow back on every poll; persist them through the
    // serialized chain so they aren't clobbered by a sibling task's write.
    const onPollUpdate: OnPollUpdate = async ({ reasoning }) => {
      if (reasoning && reasoning.length !== (task.reasoning?.length ?? 0)) {
        task.reasoning = reasoning;
        if (conversationState.id) {
          await deps.writeStateSerialized();
          await deps.notifyStateUpdated();
        }
      }
    };

    if (task.type === "LITERATURE") {
      await deps.assertNotCancelled();
      task.start = new Date().toISOString();
      task.output = "";

      if (conversationState.id) {
        setDeepResearchActivity(conversationState.values, {
          level: task.level ?? input.newLevel,
          objective: task.objective,
          phase: "literature",
          taskType: task.type,
        });
        await deps.writeStateSerialized();
        await deps.notifyStateUpdated();
      }

      logger.info({ taskObjective: task.objective }, "executing_literature_task");

      const primaryLiteratureType: LiteratureType =
        process.env.PRIMARY_LITERATURE_AGENT?.toUpperCase() === "BIO" ? "BIOLITDEEP" : "EDISON";

      const literaturePromises: Promise<void>[] = [];

      if (process.env.OPENSCHOLAR_API_URL) {
        literaturePromises.push(
          literatureAgent({ objective: task.objective, type: "OPENSCHOLAR" }).then(
            async (result) => {
              if (result.count && result.count > 0) {
                task.output += `${result.output}\n\n`;
              } else if (!result.count) {
                // Worker variant doesn't filter by count; preserve via append.
                task.output += `${result.output}\n\n`;
              }
              if (conversationState.id) {
                await deps.writeStateSerialized();
              }
            }
          )
        );
      }

      literaturePromises.push(
        literatureAgent({
          objective: task.objective,
          onJobCreated: async (jobId) => {
            task.bioLiteratureJobId = jobId;
            task.downstreamJobIds = {
              ...(task.downstreamJobIds || {}),
              bioLiterature: [...new Set([...(task.downstreamJobIds?.bioLiterature || []), jobId])],
            };
            if (conversationState.id) {
              await deps.writeStateSerialized();
              await deps.notifyStateUpdated();
            }
          },
          onPollUpdate,
          sources: task.sources,
          type: primaryLiteratureType,
        }).then(async (result) => {
          task.output += `${result.output}\n\n`;
          if (result.jobId) {
            task.jobId = result.jobId;
            if (primaryLiteratureType === "BIOLITDEEP") {
              task.bioLiteratureJobId = result.jobId;
            }
          }
          task.proteinStructures = mergeProteinStructures(
            task.proteinStructures,
            result.proteinStructures
          );
          if (conversationState.id) {
            await deps.writeStateSerialized();
          }
        })
      );

      if (process.env.KNOWLEDGE_DOCS_PATH) {
        literaturePromises.push(
          literatureAgent({ objective: task.objective, type: "KNOWLEDGE" }).then(async (result) => {
            if (result.count && result.count > 0) {
              task.output += `${result.output}\n\n`;
            } else if (!result.count) {
              task.output += `${result.output}\n\n`;
            }
            if (conversationState.id) {
              await deps.writeStateSerialized();
            }
          })
        );
      }

      await Promise.all(literaturePromises);

      task.end = new Date().toISOString();
      if (conversationState.id) {
        await deps.writeStateSerialized();
        await deps.notifyStateUpdated();
      }
      return;
    }

    if (task.type === "ANALYSIS") {
      await deps.assertNotCancelled();
      if (deps.onAnalysisStarted) {
        await deps.onAnalysisStarted();
      }

      task.start = new Date().toISOString();
      task.output = "";

      if (conversationState.id) {
        setDeepResearchActivity(conversationState.values, {
          level: task.level ?? input.newLevel,
          objective: task.objective,
          phase: "analysis",
          taskType: task.type,
        });
        await deps.writeStateSerialized();
        await deps.notifyStateUpdated();
      }

      logger.info(
        {
          datasets: task.datasets.map((d) => `${d.filename} (${d.id})`),
          taskObjective: task.objective,
        },
        "executing_analysis_task"
      );

      try {
        const type = process.env.PRIMARY_ANALYSIS_AGENT?.toUpperCase() === "BIO" ? "BIO" : "EDISON";
        const analysisResult = await analysisAgent({
          conversationStateId: conversationState.id!,
          datasets: task.datasets,
          objective: task.objective,
          onPollUpdate,
          type,
          userId: input.userId,
        });
        task.output = `${analysisResult.output}\n\n`;
        task.artifacts = analysisResult.artifacts || [];
        task.jobId = analysisResult.jobId;
        if (conversationState.id) {
          await deps.writeStateSerialized();
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message
            : typeof error === "object" && error !== null
              ? JSON.stringify(error)
              : String(error);
        task.output = `Analysis failed: ${errorMsg}`;
        logger.error({ error, taskObjective: task.objective }, "analysis_failed");
      }

      task.end = new Date().toISOString();
      if (conversationState.id) {
        await deps.writeStateSerialized();
        await deps.notifyStateUpdated();
      }
    }
  });

  await Promise.all(taskPromises);
  await deps.assertNotCancelled();
}
