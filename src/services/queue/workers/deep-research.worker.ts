/**
 * Deep Research Worker for BullMQ
 *
 * Architecture: Iteration-per-job
 * Each job executes exactly ONE iteration of the deep research workflow.
 * If the research should continue, the worker enqueues the next iteration
 * as a new job. This provides:
 * - Atomic iterations (either fully complete or never started)
 * - Better graceful shutdown (each job ~5-10 min instead of 20+ min)
 * - Natural retry on failure (no partial state to rollback)
 * - Better scaling (different workers can handle different iterations)
 */

import { Job, Worker } from "bullmq";
import type {
  ConversationState,
  ConversationStateValues,
  PlanTask,
  State,
} from "../../../types/core";
import {
  clearDeepResearchActivity,
  setDeepResearchActivity,
} from "../../../utils/deep-research/activity";
import { calculateSessionStartLevel } from "../../../utils/deep-research/continuation-utils";
import {
  completeObjectiveTrace,
  ensureObjectiveTrace,
  getObjectiveTraceObjective,
  markObjectiveTraceStale,
  syncObjectiveTraceProgress,
} from "../../../utils/deep-research/objective-trace";
import logger from "../../../utils/logger";
import { buildMessageStateValues } from "../../../utils/messageState";
import {
  DeepResearchCancelledError,
  isDeepResearchCancellationRequested,
  throwIfDeepResearchCancelled,
} from "../../deep-research/cancellation";
import { markRunFinished, touchRun } from "../../deep-research/run-guard";
import { getBullMQConnection } from "../connection";
import {
  notifyJobCompleted,
  notifyJobFailed,
  notifyJobProgress,
  notifyJobStarted,
  notifyMessageUpdated,
  notifyStateUpdated,
} from "../notify";
import { getDeepResearchQueue } from "../queues";
import type { DeepResearchJobData, DeepResearchJobResult, JobProgress } from "../types";

/**
 * Process a deep research job - executes a SINGLE iteration
 *
 * Research modes:
 * - 'semi-autonomous' (default): Uses MAX_AUTO_ITERATIONS from env (default 5)
 * - 'fully-autonomous': Continues until research is done or hard cap of 20 iterations
 * - 'steering': Single iteration only, always asks user for feedback
 */
async function processDeepResearchJob(
  job: Job<DeepResearchJobData, DeepResearchJobResult>
): Promise<DeepResearchJobResult> {
  const startTime = Date.now();
  const {
    userId,
    conversationId,
    messageId,
    rootMessageId: queuedRootMessageId,
    stateId,
    conversationStateId,
    message,
    researchMode: requestedResearchMode,
    iterationNumber = 1,
    rootJobId,
    isInitialIteration = true,
  } = job.data;
  const rootMessageId = queuedRootMessageId || (isInitialIteration ? messageId : undefined);
  let conversationState: ConversationState | null = null;
  type ConversationStateWriteOptions = {
    ensureTraceObjective?: string;
    completeTrace?: boolean;
    staleTrace?: boolean;
  };
  let updateConversationStateRef:
    | ((
        id: string,
        values: Partial<ConversationStateValues>,
        options?: { preserveUploadedDatasets?: boolean }
      ) => Promise<unknown>)
    | null = null;
  let getConversationStateRef:
    | ((id: string) => Promise<{ values: Partial<ConversationStateValues> } | null>)
    | null = null;
  let writeStateSerialized: ((options?: ConversationStateWriteOptions) => Promise<unknown>) | null =
    null;

  const readCancellationRequested = async (): Promise<boolean> => {
    const values =
      getConversationStateRef && conversationStateId
        ? (await getConversationStateRef(conversationStateId))?.values
        : conversationState?.values;
    return isDeepResearchCancellationRequested(values, { rootMessageId, stateId });
  };

  const assertNotCancelled = async () => {
    let values: Partial<ConversationStateValues> | undefined;
    if (getConversationStateRef && conversationStateId) {
      const fresh = await getConversationStateRef(conversationStateId);
      if (!fresh) {
        logger.warn(
          { conversationStateId, rootMessageId },
          "cancellation_check_state_read_returned_null"
        );
      }
      values = fresh?.values ?? conversationState?.values;
    } else {
      values = conversationState?.values;
    }
    throwIfDeepResearchCancelled(values, { rootMessageId, stateId });
  };

  const prepareConversationStateForWrite = async (options?: ConversationStateWriteOptions) => {
    if (!conversationState) {
      return;
    }

    if (options?.ensureTraceObjective) {
      await ensureObjectiveTrace(conversationState.values, options.ensureTraceObjective, {
        runRootMessageId: rootMessageId,
      });
    } else {
      syncObjectiveTraceProgress(conversationState.values);
    }

    if (options?.completeTrace) {
      completeObjectiveTrace(conversationState.values);
    }

    if (options?.staleTrace) {
      markObjectiveTraceStale(conversationState.values);
    }
  };

  const persistConversationState = async (options?: ConversationStateWriteOptions) => {
    if (!conversationState?.id || !updateConversationStateRef) {
      return;
    }

    await prepareConversationStateForWrite(options);
    await updateConversationStateRef(conversationState.id, conversationState.values);
  };

  const persistConversationActivity = async (
    params: Parameters<typeof setDeepResearchActivity>[1],
    options?: {
      serialized?: boolean;
      notify?: boolean;
      ensureTraceObjective?: string;
    }
  ) => {
    if (!conversationState?.id || !updateConversationStateRef) {
      return;
    }

    setDeepResearchActivity(conversationState.values, params);

    if (options?.serialized && writeStateSerialized) {
      await writeStateSerialized({
        ensureTraceObjective: options.ensureTraceObjective,
      });
    } else {
      await persistConversationState({
        ensureTraceObjective: options?.ensureTraceObjective,
      });
    }

    if (options?.notify !== false) {
      await notifyStateUpdated(job.id!, conversationId, conversationState.id);
    }
  };

  const clearConversationActivity = async (options?: {
    notify?: boolean;
    completeTrace?: boolean;
    staleTrace?: boolean;
  }) => {
    if (!conversationState?.id || !updateConversationStateRef) {
      return;
    }

    clearDeepResearchActivity(conversationState.values);
    await persistConversationState({
      completeTrace: options?.completeTrace,
      staleTrace: options?.staleTrace,
    });

    if (options?.notify !== false) {
      await notifyStateUpdated(job.id!, conversationId, conversationState.id);
    }
  };

  // Log retry attempt if this is a retry
  if (job.attemptsMade > 0) {
    logger.warn(
      {
        attempt: job.attemptsMade + 1,
        iterationNumber,
        jobId: job.id,
        maxAttempts: job.opts.attempts,
        messageId,
      },
      "deep_research_job_retry_attempt"
    );
  }

  logger.info(
    {
      conversationId,
      conversationStateId,
      isInitialIteration,
      iterationNumber,
      jobId: job.id,
      messageId,
      messageLength: message?.length,
      messagePreview: message
        ? message.length > 200
          ? message.substring(0, 200) + "..."
          : message
        : undefined,
      requestedResearchMode,
      rootJobId: rootJobId || job.id,
      stateId,
      userId,
    },
    "deep_research_job_started"
  );

  // Notify: Job started
  await notifyJobStarted(job.id!, conversationId, messageId, stateId);

  try {
    try {
      await touchRun({
        conversationStateId,
        rootMessageId,
        stateId,
      });
    } catch (error) {
      logger.warn(
        { conversationStateId, error, rootMessageId, stateId },
        "deep_research_worker_heartbeat_failed_at_start"
      );
    }

    // Import required modules
    const { getMessage, getState, getConversationState, updateConversationState } = await import(
      "../../../db/operations"
    );
    updateConversationStateRef = updateConversationState;
    getConversationStateRef = getConversationState;

    // Get message record
    const messageRecord = await getMessage(messageId);
    if (!messageRecord) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // Get state record
    const stateRecord = await getState(stateId);
    if (!stateRecord) {
      throw new Error(`State not found: ${stateId}`);
    }

    // Get conversation state
    const conversationStateRecord = await getConversationState(conversationStateId);
    if (!conversationStateRecord) {
      throw new Error(`Conversation state not found: ${conversationStateId}`);
    }

    // Initialize state objects
    const state: State = {
      id: stateRecord.id,
      values: buildMessageStateValues({
        baseValues: stateRecord.values,
        isDeepResearch: true,
        message: messageRecord,
      }),
    };

    conversationState = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    await assertNotCancelled();

    // Reconcile researchMode: request takes priority, then existing state, then default
    type ResearchMode = "semi-autonomous" | "fully-autonomous" | "steering";
    const researchMode: ResearchMode =
      requestedResearchMode || conversationState.values.researchMode || "semi-autonomous";

    // Save researchMode to conversation state (allows it to change per request)
    conversationState.values.researchMode = researchMode;

    // Calculate max iterations based on mode
    const maxAutoIterations =
      researchMode === "steering"
        ? 1 // Steering mode: single iteration, always ask user
        : researchMode === "fully-autonomous"
          ? 20 // Fully autonomous: hard cap
          : parseInt(process.env.MAX_AUTO_ITERATIONS || "5"); // Semi-autonomous: configurable

    // Variables for this iteration
    let tasksToExecute: PlanTask[] = [];
    let hypothesisResult: { hypothesis: string; mode: string } = {
      hypothesis: "",
      mode: "create",
    };

    // Track the current message being updated
    const currentMessage = messageRecord;

    // Track starting level for this user interaction (to gather all tasks across continuations)
    const sessionStartLevel = calculateSessionStartLevel(conversationState.values.currentLevel);

    logger.info(
      {
        isInitialIteration,
        iterationNumber,
        jobId: job.id,
        maxAutoIterations,
        researchMode,
      },
      "starting_iteration"
    );

    // =========================================================================
    // SINGLE ITERATION EXECUTION
    // =========================================================================

    // Update progress: Planning
    await assertNotCancelled();
    await job.updateProgress({ percent: 5, stage: "planning" } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "planning", 5);

    if (isInitialIteration) {
      await persistConversationActivity(
        {
          level: conversationState.values.currentLevel,
          objective:
            conversationState.values.currentObjective ||
            conversationState.values.evolvingObjective ||
            conversationState.values.objective ||
            messageRecord.question ||
            message,
          phase: "planning",
        },
        {
          ensureTraceObjective: getObjectiveTraceObjective(
            conversationState.values,
            messageRecord.question || message
          ),
        }
      );
    }

    // Worker notifies after planning because, unlike the route, it doesn't
    // call persistConversationActivity before this phase.
    const { runPlanningPhase } = await import("../../deep-research/phases/planning");
    const planning = await runPlanningPhase(
      {
        conversationState,
        currentMessage: messageRecord,
        isInitialIteration,
        iterationCount: iterationNumber,
        researchMode,
        rootMessage: messageRecord,
        skipPlanning: !isInitialIteration,
        state,
      },
      { assertNotCancelled, getObjectiveTraceObjective, persistConversationState }
    );
    const newLevel: number = planning.newLevel;
    const currentObjective: string = planning.currentObjective;
    if (conversationState.id) {
      await notifyStateUpdated(job.id!, conversationId, conversationState.id);
    }

    // Update progress: Literature/Analysis
    await assertNotCancelled();
    await job.updateProgress({
      percent: 20,
      stage: "literature",
    } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "literature", 20);

    tasksToExecute = (conversationState.values.plan || []).filter(
      (t) => t.level === newLevel && !t.end // Skip already-completed tasks (for retry safety)
    );

    logger.info(
      {
        allPlanLevels: [...new Set((conversationState.values.plan || []).map((t) => t.level))],
        iterationNumber,
        jobId: job.id,
        newLevel,
        taskIds: tasksToExecute.map((t) => t.id),
        tasksToExecuteCount: tasksToExecute.length,
      },
      "tasks_to_execute_for_iteration"
    );
    const activeConversationState = conversationState;

    // Serialize DB writes to prevent concurrent updateConversationState calls
    // from overwriting each other's changes (matches in-process mode pattern)
    let stateWriteChain = Promise.resolve();
    writeStateSerialized = async (options?: ConversationStateWriteOptions) => {
      const p = stateWriteChain.then(async () => {
        await prepareConversationStateForWrite(options);
        return updateConversationState(activeConversationState.id!, activeConversationState.values);
      });
      stateWriteChain = p.catch((err) => {
        logger.error(
          {
            conversationStateId: activeConversationState.id,
            err,
            rootMessageId,
          },
          "state_write_chain_error_suppressed"
        );
      }); // prevent unhandled rejection from blocking chain
      return p;
    };

    const { runExecutionPhase } = await import("../../deep-research/phases/execution");
    await runExecutionPhase(
      {
        conversationState: activeConversationState,
        newLevel,
        tasksToExecute,
        userId: messageRecord.user_id,
      },
      {
        assertNotCancelled,
        notifyStateUpdated: async () => {
          if (!activeConversationState.id) return;
          await notifyStateUpdated(job.id!, conversationId, activeConversationState.id);
        },
        onAnalysisStarted: async () => {
          await job.updateProgress({ percent: 50, stage: "analysis" } as JobProgress);
          await notifyJobProgress(job.id!, conversationId, "analysis", 50);
        },
        writeStateSerialized: () => writeStateSerialized!(),
      }
    );

    logger.info(
      { completedTasksCount: tasksToExecute.length, jobId: job.id },
      "deep_research_job_tasks_completed_via_shared_phase"
    );

    // Update progress: Hypothesis
    await job.updateProgress({
      percent: 70,
      stage: "hypothesis",
    } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "hypothesis", 70);

    await persistConversationActivity({
      level: newLevel,
      objective: currentObjective || conversationState.values.currentObjective,
      phase: "reflection",
    });

    const { runHypothesisPhase } = await import("../../deep-research/phases/hypothesis");
    hypothesisResult = await runHypothesisPhase(
      {
        completedTasks: tasksToExecute,
        conversationState,
        message: messageRecord,
        objective: currentObjective,
      },
      { assertNotCancelled, persistConversationState }
    );

    // Update progress: Reflection
    await job.updateProgress({
      percent: 85,
      stage: "reflection",
    } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "reflection", 85);

    const { runReflectionDiscoveryPhase } = await import(
      "../../deep-research/phases/reflection-discovery"
    );
    await runReflectionDiscoveryPhase(
      {
        completedTasks: tasksToExecute,
        conversationState,
        hypothesis: hypothesisResult.hypothesis,
        message: messageRecord,
      },
      { assertNotCancelled, getObjectiveTraceObjective, persistConversationState }
    );

    if (conversationState.id) {
      await notifyStateUpdated(job.id!, conversationId, conversationState.id);
    }

    const { runNextStepsPhase } = await import("../../deep-research/phases/next-steps");
    const nextStepsResult = await runNextStepsPhase(
      {
        conversationState,
        currentObjective,
        message: messageRecord,
        newLevel,
        researchMode,
        state,
      },
      {
        assertNotCancelled,
        getObjectiveTraceObjective,
        persistConversationActivity,
        persistConversationState,
      }
    );

    const shouldContinue = nextStepsResult.hasSuggestions;

    const { runContinueDecisionPhase } = await import(
      "../../deep-research/phases/continue-decision"
    );
    const continueDecision = await runContinueDecisionPhase(
      {
        completedTasks: tasksToExecute,
        conversationState,
        hypothesis: hypothesisResult.hypothesis,
        iterationCount: iterationNumber,
        loopAlive: shouldContinue,
        maxAutoIterations,
        message: currentMessage,
        researchMode,
      },
      { assertNotCancelled }
    );
    const { isFinal, willContinue } = continueDecision;

    await job.updateProgress({ percent: 95, stage: "reply" } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "reply", 95);

    const { markMessageComplete } = await import("../../chat/tools");
    const { runReplyPhase } = await import("../../deep-research/phases/reply");
    await runReplyPhase(
      {
        conversationState,
        currentMessage,
        currentObjective,
        hypothesis: hypothesisResult.hypothesis,
        isFinal,
        iterationCount: iterationNumber,
        iterationStartTime: startTime,
        newLevel,
        sessionStartLevel,
        state,
      },
      {
        assertNotCancelled,
        markMessageComplete,
        notifyMessageUpdated: async () => {
          await notifyMessageUpdated(job.id!, conversationId, currentMessage.id);
        },
        persistConversationActivity,
        persistConversationState,
      }
    );

    // Enqueue next iteration (if continuing). Continuation-prep is shared
    // with the route; this branch only diverges in how the new message is
    // scheduled — the worker enqueues a fresh BullMQ job instead of looping.
    if (willContinue) {
      logger.info({ iterationNumber, jobId: job.id }, "preparing_next_iteration_job");

      const { runContinuationPrepPhase } = await import(
        "../../deep-research/phases/continuation-prep"
      );
      const continuation = await runContinuationPrepPhase(
        {
          conversationState,
          currentMessage,
          currentObjective,
          stateId,
          userMessage: message,
        },
        {
          assertNotCancelled,
          getObjectiveTraceObjective,
          persistConversationActivity,
        }
      );
      const agentMessage = continuation.newMessage;

      // ENQUEUE NEXT ITERATION JOB
      const queue = getDeepResearchQueue();
      const nextMessageId = agentMessage.id!; // createMessage always returns an ID
      const nextJobName = `iteration-${iterationNumber + 1}-${nextMessageId}`;

      try {
        await queue.add(
          nextJobName,
          {
            authMethod: job.data.authMethod,
            conversationId,
            conversationStateId,
            isInitialIteration: false, // Use promoted tasks, skip planning
            iterationNumber: iterationNumber + 1,
            message, // Original message for context
            messageId: nextMessageId, // Next iteration writes to new message
            requestedAt: new Date().toISOString(),
            researchMode,
            rootJobId: rootJobId || job.id!, // Track the chain back to original
            rootMessageId,
            stateId,
            userId,
          },
          {
            jobId: nextMessageId, // Use message ID as job ID for easy lookup
          }
        );
      } catch (enqueueErr) {
        // The continuation message row exists in DB but no BullMQ job owns it.
        // Mark it FAILED immediately so the status endpoint and UI won't spin forever.
        try {
          const { markMessageFailed } = await import("../../chat/tools");
          await markMessageFailed(nextMessageId);
        } catch (msgErr) {
          logger.warn(
            { msgErr, nextMessageId },
            "deep_research_worker_mark_continuation_message_failed_on_enqueue_error"
          );
        }
        throw enqueueErr;
      }

      logger.info(
        {
          jobId: job.id,
          nextIterationNumber: iterationNumber + 1,
          nextJobName,
          nextMessageId,
          rootJobId: rootJobId || job.id,
        },
        "enqueued_next_iteration_job"
      );

      try {
        await touchRun({
          conversationStateId,
          rootMessageId,
          stateId,
        });
      } catch (error) {
        logger.warn(
          { conversationStateId, error, rootMessageId, stateId },
          "deep_research_worker_heartbeat_failed_after_enqueue"
        );
      }
    }

    // =========================================================================
    // JOB COMPLETE
    // =========================================================================
    const responseTime = Date.now() - startTime;

    logger.info(
      {
        isFinal,
        iterationNumber,
        jobId: job.id,
        messageId: currentMessage.id,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
        willContinue,
      },
      "deep_research_job_completed"
    );

    if (isFinal) {
      await clearConversationActivity({ completeTrace: true });
    }

    // Notify: Job completed
    await notifyJobCompleted(job.id!, conversationId, currentMessage.id, stateId);

    // Complete credits when research is truly done (final iteration)
    if (isFinal) {
      try {
        await markRunFinished({
          conversationStateId,
          result: "completed",
          rootMessageId,
          stateId,
        });
      } catch (error) {
        logger.warn(
          { conversationStateId, error, rootMessageId, stateId },
          "deep_research_worker_finish_mark_failed_on_success"
        );
      }

      try {
        const { getServiceClient } = await import("../../../db/client");
        const supabase = getServiceClient();

        // Look up Privy ID from database user ID (credits are keyed by Privy ID)
        const { data: userData } = await supabase
          .from("users")
          .select("user_id")
          .eq("id", userId)
          .single();

        const privyId = userData?.user_id;
        if (!privyId) {
          logger.warn({ userId }, "credit_completion_skipped_no_privy_id");
        } else {
          const { data, error } = await supabase.rpc("complete_deep_research_job", {
            p_final_iterations: iterationNumber,
            p_job_id: job.data.rootJobId || job.id,
            p_user_id: privyId,
          });

          if (error) {
            logger.error({ error, privyId }, "credit_completion_failed");
          } else {
            logger.info(
              {
                iterations: iterationNumber,
                privyId,
                refunded: data?.refunded,
              },
              "credits_completed"
            );
          }
        }
      } catch (err) {
        logger.error({ err }, "credit_completion_error");
      }
    }

    return {
      messageId: currentMessage.id,
      responseTime,
      status: "completed",
    };
  } catch (error) {
    if (error instanceof DeepResearchCancelledError || (await readCancellationRequested())) {
      logger.info(
        {
          iterationNumber,
          jobId: job.id,
          messageId,
        },
        "deep_research_job_cancelled"
      );
      try {
        await notifyStateUpdated(job.id!, conversationId, conversationStateId);
      } catch (notifyError) {
        logger.warn({ jobId: job.id, notifyError }, "deep_research_cancel_notify_failed");
      }
      return {
        messageId,
        responseTime: Date.now() - startTime,
        status: "cancelled",
      } as DeepResearchJobResult;
    }

    logger.error(
      {
        attempt: job.attemptsMade + 1,
        error,
        iterationNumber,
        jobId: job.id,
        willRetry: job.attemptsMade + 1 < (job.opts.attempts || 2),
      },
      "deep_research_job_failed"
    );

    // Update state to mark as failed (only on final attempt)
    if (job.attemptsMade + 1 >= (job.opts.attempts || 2)) {
      try {
        const { updateState } = await import("../../../db/operations");
        await updateState(stateId, {
          error: error instanceof Error ? error.message : "Unknown error",
          status: "failed",
        });
      } catch (updateErr) {
        logger.error({ updateErr }, "failed_to_update_state_on_error");
      }

      try {
        const { markMessageFailed } = await import("../../chat/tools");
        await markMessageFailed(messageId);
      } catch (msgErr) {
        logger.warn({ messageId, msgErr }, "deep_research_worker_mark_message_failed_on_failure");
      }

      try {
        await clearConversationActivity({ staleTrace: true });
      } catch (activityErr) {
        logger.warn({ activityErr }, "deep_research_worker_clear_activity_failed_on_error");
      }

      try {
        await notifyJobFailed(job.id!, conversationId, messageId, stateId);
      } catch (notifyErr) {
        logger.warn({ notifyErr }, "deep_research_worker_notify_job_failed_error");
      }

      try {
        await markRunFinished({
          conversationStateId,
          error: error instanceof Error ? error.message : "Unknown error",
          result: "failed",
          rootMessageId,
          stateId,
        });
      } catch (finishError) {
        logger.warn(
          {
            conversationStateId,
            finishError,
            rootMessageId,
            stateId,
          },
          "deep_research_worker_finish_mark_failed_on_failure"
        );
      }

      // Refund credits on final failure
      try {
        const { getServiceClient } = await import("../../../db/client");
        const supabase = getServiceClient();

        // Look up Privy ID from database user ID (credits are keyed by Privy ID)
        const { data: userData } = await supabase
          .from("users")
          .select("user_id")
          .eq("id", userId)
          .single();

        const privyId = userData?.user_id;
        if (!privyId) {
          logger.warn({ userId }, "credit_refund_skipped_no_privy_id");
        } else {
          const { data, error: refundError } = await supabase.rpc("refund_deep_research_credits", {
            p_job_id: job.data.rootJobId || job.id,
            p_user_id: privyId,
          });

          if (refundError) {
            logger.error({ privyId, refundError }, "credit_refund_failed");
          } else {
            logger.info({ privyId, refunded: data?.refunded }, "credits_refunded_on_failure");
          }
        }
      } catch (creditErr) {
        logger.error({ creditErr }, "failed_to_refund_credits_on_error");
      }
    }

    // Re-throw to trigger retry (if attempts remaining)
    throw error;
  }
}

/**
 * Start the deep research worker
 */
export function startDeepResearchWorker(): Worker {
  const concurrency = parseInt(process.env.DEEP_RESEARCH_QUEUE_CONCURRENCY || "3");

  const worker = new Worker<DeepResearchJobData, DeepResearchJobResult>(
    "deep-research",
    processDeepResearchJob,
    {
      concurrency,
      connection: getBullMQConnection(),
      // Deep research with autonomous mode can take 2-8 hours
      // lockRenewTime must be significantly less than lockDuration (1/6 ratio)
      lockDuration: 1800000, // 30 minutes - covers most iterations including slow analysis
      lockRenewTime: 300000, // 5 minutes - renew frequently (6x before expiry)
      stalledInterval: 600000, // 10 minutes - detect stalled jobs reasonably fast
    }
  );

  worker.on("completed", (job, result) => {
    logger.info(
      {
        iterationNumber: job.data.iterationNumber,
        jobId: job.id,
        messageId: result.messageId,
        responseTime: result.responseTime,
      },
      "deep_research_worker_job_completed"
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        attemptsMade: job?.attemptsMade,
        error: error.message,
        iterationNumber: job?.data.iterationNumber,
        jobId: job?.id,
      },
      "deep_research_worker_job_failed_permanently"
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "deep_research_worker_job_stalled");
  });

  logger.info({ concurrency }, "deep_research_worker_started");

  return worker;
}
