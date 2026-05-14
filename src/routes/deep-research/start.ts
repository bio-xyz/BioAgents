import { Elysia } from "elysia";
import { fileUploadAgent } from "../../agents/fileUpload";
import { initKnowledgeBase } from "../../agents/literature/knowledge";
import { getClarificationSessionForUser, linkSessionToConversation } from "../../db/clarification";
import {
  createMessage,
  type DbConversationState,
  type DbState,
  getConversationState,
  updateConversationState,
  updateState,
} from "../../db/operations";
import { authResolver } from "../../middleware/authResolver";
import { rateLimitMiddleware } from "../../middleware/rateLimiter";
import { ensureUserAndConversation, setupConversationData } from "../../services/chat/setup";
import { createMessageRecord } from "../../services/chat/tools";
import {
  DeepResearchCancelledError,
  isDeepResearchCancellationRequested,
  throwIfDeepResearchCancelled,
} from "../../services/deep-research/cancellation";
import { runContinuationPrepPhase } from "../../services/deep-research/phases/continuation-prep";
import { runContinueDecisionPhase } from "../../services/deep-research/phases/continue-decision";
import { runExecutionPhase } from "../../services/deep-research/phases/execution";
import { runHypothesisPhase } from "../../services/deep-research/phases/hypothesis";
import { runNextStepsPhase } from "../../services/deep-research/phases/next-steps";
import { runPlanningPhase } from "../../services/deep-research/phases/planning";
import { runReflectionDiscoveryPhase } from "../../services/deep-research/phases/reflection-discovery";
import { runReplyPhase } from "../../services/deep-research/phases/reply";
import {
  acquireStartMutex,
  getActiveRunForDedupFromValues,
  isStaleRun,
  markRunFinished,
  markRunStarted,
  releaseStartMutex,
  touchRun,
  updateRunJobId,
} from "../../services/deep-research/run-guard";
import { isJobQueueEnabled } from "../../services/queue/connection";
import { notifyMessageUpdated, notifyStateUpdated } from "../../services/queue/notify";
import { getDeepResearchQueue } from "../../services/queue/queues";
import type { ConversationState, PlanTask, State } from "../../types/core";
import type { ElysiaRouteContext } from "../../types/elysia";
import { parseSourceSelectionId } from "../../types/sourceSelection";
import { asString, extractFiles, isBodyRecord } from "../../utils/bodyParsing";
import {
  clearDeepResearchActivity,
  setDeepResearchActivity,
} from "../../utils/deep-research/activity";
import { calculateSessionStartLevel } from "../../utils/deep-research/continuation-utils";
import {
  completeObjectiveTrace,
  ensureObjectiveTrace,
  getObjectiveTraceObjective,
  markObjectiveTraceStale,
  syncObjectiveTraceProgress,
} from "../../utils/deep-research/objective-trace";
import logger from "../../utils/logger";
import { buildMessageStateValues } from "../../utils/messageState";
import { generateUUID } from "../../utils/uuid";

type CreatedMessage = Awaited<ReturnType<typeof createMessage>>;

initKnowledgeBase();

/**
 * Response type for deep research start (in-process mode)
 */
type DeepResearchStartResponse = {
  messageId: string | null;
  conversationId: string;
  userId: string;
  status: "processing";
  pollUrl?: string;
  deduplicated?: true;
  error?: string;
};

/**
 * Response type for deep research start (queue mode)
 */
type DeepResearchQueuedResponse = {
  jobId?: string;
  messageId: string;
  conversationId: string;
  userId: string;
  status: "queued";
  pollUrl: string;
  deduplicated?: true;
};

type DeepResearchStartFailureLogger = {
  error: (payload: Record<string, unknown>, message: string) => void;
  warn: (payload: Record<string, unknown>, message: string) => void;
};

type DeepResearchStartFailureDeps = {
  clearDeepResearchActivity: (values: ConversationState["values"]) => void;
  ensureObjectiveTrace: (
    values: ConversationState["values"],
    objective?: string,
    options?: { runRootMessageId?: string }
  ) => Promise<unknown>;
  getObjectiveTraceObjective: (
    values: ConversationState["values"],
    fallbackObjective?: string
  ) => string | undefined;
  markObjectiveTraceStale: (values: ConversationState["values"]) => unknown;
  updateConversationState: (id: string, values: ConversationState["values"]) => Promise<unknown>;
  notifyStateUpdated: (jobId: string, conversationId: string, stateId: string) => Promise<unknown>;
  updateState: (id: string, values: Record<string, unknown>) => Promise<unknown>;
  markRunFinished: (params: {
    conversationStateId: string;
    result: "failed";
    error?: string;
    rootMessageId?: string;
    stateId?: string;
  }) => Promise<unknown>;
  logger: DeepResearchStartFailureLogger;
};

type DeepResearchStartFailureParams = {
  activeConversationState: ConversationState | null;
  conversationId: string;
  conversationStateId: string;
  err: unknown;
  notificationJobId: string;
  rootMessageId: string;
  stateRecord: {
    id: string;
    values: State["values"];
  };
};

const deepResearchStartFailureDeps: DeepResearchStartFailureDeps = {
  clearDeepResearchActivity,
  ensureObjectiveTrace,
  getObjectiveTraceObjective,
  logger,
  markObjectiveTraceStale,
  markRunFinished,
  notifyStateUpdated,
  updateConversationState,
  updateState,
};

async function handleDeepResearchStartFailure(
  params: DeepResearchStartFailureParams,
  deps: DeepResearchStartFailureDeps = deepResearchStartFailureDeps
): Promise<void> {
  const {
    activeConversationState,
    conversationId,
    conversationStateId,
    err,
    notificationJobId,
    rootMessageId,
    stateRecord,
  } = params;

  const errorMessage = err instanceof Error ? err.message : "Unknown error";

  if (activeConversationState?.id) {
    try {
      deps.clearDeepResearchActivity(activeConversationState.values);
      await deps.ensureObjectiveTrace(
        activeConversationState.values,
        deps.getObjectiveTraceObjective(activeConversationState.values),
        {
          runRootMessageId: rootMessageId,
        }
      );
      deps.markObjectiveTraceStale(activeConversationState.values);
      await deps.updateConversationState(
        activeConversationState.id,
        activeConversationState.values
      );
      await deps.notifyStateUpdated(notificationJobId, conversationId, activeConversationState.id);
    } catch (cleanupErr) {
      deps.logger.error(
        {
          cleanupErr,
          conversationStateId,
          messageId: notificationJobId,
          originalErr: err,
          rootMessageId,
        },
        "deep_research_error_cleanup_failed"
      );
    }
  }

  await deps.updateState(stateRecord.id, {
    ...stateRecord.values,
    error: errorMessage,
    status: "failed",
  });

  try {
    await deps.markRunFinished({
      conversationStateId,
      error: errorMessage,
      result: "failed",
      rootMessageId,
      stateId: stateRecord.id,
    });
  } catch (finishError) {
    deps.logger.warn(
      {
        conversationStateId,
        finishError,
        rootMessageId,
        stateId: stateRecord.id,
      },
      "deep_research_run_finish_mark_failed_on_failure"
    );
  }
}

export const __deepResearchStartTestables = {
  handleDeepResearchStartFailure,
  runDeepResearch,
};

function buildDeepResearchPollUrl(messageId: string): string {
  return `/api/deep-research/status/${messageId}`;
}

/**
 * Deep Research Start Route - Returns immediately with messageId
 * The actual research runs in the background
 * Uses guard pattern to ensure auth runs for all routes
 *
 * Supports dual mode:
 * - USE_JOB_QUEUE=false (default): Fire-and-forget async execution
 * - USE_JOB_QUEUE=true: Enqueues job to BullMQ for worker processing
 */
export const deepResearchStartRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true, // Always require auth - no environment-based bypass
      }),
      rateLimitMiddleware("deep-research"),
    ],
  },
  (app) =>
    app
      .get("/api/deep-research/start", async () => {
        return {
          apiDocumentation: "https://your-docs-url.com/api",
          message: "This endpoint requires POST method.",
        };
      })
      .post("/api/deep-research/start", deepResearchStartHandler)
);

/**
 * Deep Research Start Handler - Core logic for POST /api/deep-research/start
 */
export async function deepResearchStartHandler(ctx: ElysiaRouteContext) {
  const { body, set, request } = ctx;

  const parsedBody = isBodyRecord(body) ? body : {};

  // Extract message (REQUIRED)
  const message = asString(parsedBody.message);
  if (!message) {
    set.status = 400;
    return {
      error: "Missing required field: message",
      ok: false,
    };
  }

  // Get userId from auth context (set by authResolver middleware)
  const auth = request.auth;
  const userId = auth?.userId || generateUUID();
  const source = "api";

  logger.info(
    {
      authMethod: auth?.method || "unknown",
      source,
      userId,
      verified: auth?.verified || false,
    },
    "deep_research_user_identified_via_auth"
  );

  // Auto-generate conversationId if not provided
  let conversationId = asString(parsedBody.conversationId);
  if (!conversationId) {
    conversationId = generateUUID();
    if (logger) {
      logger.info({ conversationId, userId }, "auto_generated_conversation_id");
    }
  }

  // Extract researchMode from request (will be reconciled with conversation state later)
  // Modes: 'semi-autonomous' (default), 'fully-autonomous', 'steering'
  type ResearchMode = "semi-autonomous" | "fully-autonomous" | "steering";
  const rawResearchMode = asString(parsedBody.researchMode);
  const requestedResearchMode: ResearchMode | undefined =
    rawResearchMode === "semi-autonomous" ||
    rawResearchMode === "fully-autonomous" ||
    rawResearchMode === "steering"
      ? rawResearchMode
      : undefined;

  // Extract clarificationSessionId from request (optional)
  const clarificationSessionId = asString(parsedBody.clarificationSessionId);
  const sourceSelectionId = parseSourceSelectionId(asString(parsedBody.sourceSelectionId));
  if (parsedBody.sourceSelectionId !== undefined && !sourceSelectionId) {
    set.status = 400;
    return {
      error: "Invalid sourceSelectionId",
      ok: false,
    };
  }

  // Extract files from parsed body
  const files: File[] = extractFiles(parsedBody.files);

  // Log request details
  if (logger) {
    logger.info(
      {
        conversationId,
        fileCount: files.length,
        message: message,
        requestedResearchMode,
        routeType: "deep-research-v2-start",
        source,
        sourceSelectionId,
        userId,
      },
      "deep_research_start_request_received"
    );
  }

  // Ensure user and conversation exist
  const setupResult = await ensureUserAndConversation(userId, conversationId);
  if (!setupResult.success) {
    set.status = 500;
    return { error: setupResult.error || "Setup failed", ok: false };
  }

  // Setup conversation data
  const dataSetup = await setupConversationData(
    conversationId,
    userId,
    source,
    false, // isExternal
    message,
    files.length
  );
  if (!dataSetup.success) {
    set.status = 500;
    return { error: dataSetup.error || "Data setup failed", ok: false };
  }

  const { conversationStateRecord, stateRecord } = dataSetup.data!;
  const queueEnabled = isJobQueueEnabled();
  const runMode: "queue" | "in-process" = queueEnabled ? "queue" : "in-process";
  let researchMode: ResearchMode = "semi-autonomous";
  let createdMessage: CreatedMessage | null = null;
  let runMarkedStarted = false;
  let activeConversationState: ConversationState | null = null;

  // Log with state IDs now that we have them
  logger.info(
    {
      conversationId,
      conversationStateId: conversationStateRecord.id,
      messageLength: message.length,
      messagePreview: message.length > 200 ? message.substring(0, 200) + "..." : message,
      stateId: stateRecord.id,
      userId,
    },
    "deep_research_state_initialized"
  );

  const startMutex = await acquireStartMutex(conversationStateRecord.id);
  if (!startMutex.acquired && !startMutex.fallback) {
    logger.warn(
      { conversationStateId: conversationStateRecord.id },
      "deep_research_start_proceeding_without_mutex"
    );
  }

  try {
    // Re-read latest state while inside start mutex
    const latestConversationStateRecord = await getConversationState(conversationStateRecord.id);
    if (latestConversationStateRecord?.values) {
      conversationStateRecord.values = latestConversationStateRecord.values;
    }

    const activeRun = getActiveRunForDedupFromValues(conversationStateRecord.values);
    if (activeRun) {
      logger.info(
        {
          activeJobId: activeRun.jobId,
          activeRootMessageId: activeRun.messageId,
          activeRunMode: activeRun.mode,
          conversationId,
          conversationStateId: conversationStateRecord.id,
        },
        "deep_research_start_deduplicated_active_run"
      );

      const pollUrl = buildDeepResearchPollUrl(activeRun.messageId);

      if (activeRun.mode === "queue") {
        const dedupeResponse: DeepResearchQueuedResponse = {
          ...(activeRun.jobId ? { jobId: activeRun.jobId } : {}),
          conversationId,
          deduplicated: true,
          messageId: activeRun.messageId,
          pollUrl,
          status: "queued",
          userId,
        };

        return new Response(JSON.stringify(dedupeResponse), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          status: 202,
        });
      }

      const dedupeResponse: DeepResearchStartResponse = {
        conversationId,
        deduplicated: true,
        messageId: activeRun.messageId,
        pollUrl,
        status: "processing",
        userId,
      };

      return new Response(JSON.stringify(dedupeResponse), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        status: 202,
      });
    }

    if (isStaleRun(conversationStateRecord.values.deepResearchRun)) {
      await markRunFinished({
        conversationStateId: conversationStateRecord.id,
        result: "stale_recovered",
      });

      const refreshedConversationStateRecord = await getConversationState(
        conversationStateRecord.id
      );
      if (refreshedConversationStateRecord?.values) {
        conversationStateRecord.values = refreshedConversationStateRecord.values;
      }

      logger.warn(
        {
          conversationId,
          conversationStateId: conversationStateRecord.id,
        },
        "deep_research_stale_run_recovered"
      );
    }

    // Reconcile researchMode: request takes priority, then existing state, then default
    researchMode =
      requestedResearchMode || conversationStateRecord.values.researchMode || "semi-autonomous";

    // Save researchMode to conversation state (allows it to change per request)
    conversationStateRecord.values.researchMode = researchMode;

    logger.info(
      {
        requestedResearchMode,
        researchMode,
        stateResearchMode: conversationStateRecord.values.researchMode,
      },
      "research_mode_resolved"
    );

    // Persist researchMode before run starts so dedupe/continuations see latest mode immediately.
    await updateConversationState(conversationStateRecord.id, conversationStateRecord.values);

    // =========================================================================
    // CLARIFICATION CONTEXT: Process approved plan from clarification session
    // =========================================================================
    if (clarificationSessionId) {
      logger.info({ clarificationSessionId, userId }, "processing_clarification_session");

      // Get and validate clarification session
      const clarificationSession = await getClarificationSessionForUser(
        clarificationSessionId,
        userId
      );

      if (!clarificationSession) {
        set.status = 404;
        return {
          error: "Clarification session not found or access denied",
          ok: false,
        };
      }

      if (clarificationSession.status !== "plan_approved") {
        set.status = 400;
        return {
          error: `Clarification session must be approved. Current status: ${clarificationSession.status}`,
          ok: false,
        };
      }

      if (!clarificationSession.plan) {
        set.status = 400;
        return {
          error: "Clarification session has no approved plan",
          ok: false,
        };
      }

      // Build questions and answers array
      const questionsAndAnswers = clarificationSession.questions.map((q, i) => {
        const answer = clarificationSession.answers.find((a) => a.questionIndex === i);
        return {
          answer: answer?.answer || "",
          question: q.question,
        };
      });

      // Build clarification context (refined objective + Q&A + initial tasks for planning)
      // The worker will handle promoting initialTasks to the plan on first iteration
      // Note: initialTasks use datasetFilenames (just names) that get resolved to actual dataset objects at execution time
      conversationStateRecord.values.clarificationContext = {
        initialTasks:
          clarificationSession.plan.initialTasks.length > 0
            ? clarificationSession.plan.initialTasks.map((task) => ({
                datasetFilenames: task.datasetFilenames || [],
                objective: task.objective,
                sources: task.sources,
                type: task.type,
              }))
            : undefined,
        questionsAndAnswers,
        refinedObjective: clarificationSession.plan.objective,
        sessionId: clarificationSessionId,
      };

      logger.info(
        {
          initialTaskCount: clarificationSession.plan.initialTasks.length,
          taskTypes: clarificationSession.plan.initialTasks.map((t) => t.type),
        },
        "clarification_context_with_initial_tasks_stored"
      );

      // Link clarification session to conversation
      await linkSessionToConversation(clarificationSessionId, conversationId);

      // Persist clarification context and plan to DB (needed for worker mode)
      await updateConversationState(conversationStateRecord.id, conversationStateRecord.values);

      logger.info(
        {
          clarificationSessionId,
          conversationId,
          qaCount: questionsAndAnswers.length,
        },
        "clarification_context_added_to_conversation"
      );
    }

    // Create message record
    const messageResult = await createMessageRecord({
      conversationId,
      files,
      isExternal: false,
      message,
      source,
      sourceSelectionId,
      stateId: stateRecord.id,
      userId,
    });
    if (!messageResult.success) {
      set.status = 500;
      return {
        error: messageResult.error || "Message creation failed",
        ok: false,
      };
    }

    createdMessage = messageResult.message!;

    stateRecord.values = buildMessageStateValues({
      baseValues: stateRecord.values,
      isDeepResearch: true,
      message: createdMessage,
    });
    await updateState(stateRecord.id, stateRecord.values);

    const startedRun = await markRunStarted({
      conversationStateId: conversationStateRecord.id,
      mode: runMode,
      rootMessageId: createdMessage.id,
      stateId: stateRecord.id,
    });
    conversationStateRecord.values.deepResearchRun = startedRun;
    runMarkedStarted = true;
  } finally {
    await releaseStartMutex(startMutex);
  }

  if (!createdMessage) {
    set.status = 500;
    return {
      error: "Failed to initialize deep research run",
      ok: false,
    };
  }

  // Mark the state row as deep-research at enqueue time so the message
  // sweeper can distinguish queued deep-research jobs from chat orphans
  // before the worker (which also sets this flag) ever runs. A queued job
  // sitting in BullMQ backlog past the sweeper's threshold would otherwise
  // get incorrectly swept. Strict — if this write fails the sweeper boundary
  // is unsafe, so we surface the error instead of silently letting the job
  // enqueue without a discriminator. The user retries; transient Supabase
  // hiccups recover on the next request. Long-term fix is an atomic
  // discriminator column on messages.
  const stateValuesWithFlag = { ...stateRecord.values, isDeepResearch: true };
  await updateState(stateRecord.id, stateValuesWithFlag);
  stateRecord.values = stateValuesWithFlag;

  // =========================================================================
  // DUAL MODE: Check if job queue is enabled
  // =========================================================================
  if (queueEnabled) {
    try {
      // QUEUE MODE: Enqueue job and return immediately
      logger.info(
        { conversationId, messageId: createdMessage.id },
        "deep_research_using_queue_mode"
      );

      // Process files synchronously before enqueuing (files can't be serialized)
      if (files.length > 0) {
        const conversationState: ConversationState = {
          id: conversationStateRecord.id,
          values: conversationStateRecord.values,
        };

        logger.info({ fileCount: files.length }, "processing_file_uploads_before_queue");

        await fileUploadAgent({
          conversationState,
          files,
          userId,
        });
      }

      // Enqueue the job (iteration 1)
      const deepResearchQueue = getDeepResearchQueue();

      const job = await deepResearchQueue.add(
        `iteration-1-${createdMessage.id}`,
        {
          authMethod: auth?.method || "anonymous",
          conversationId,
          conversationStateId: conversationStateRecord.id,
          isInitialIteration: true,
          // Iteration tracking (iteration-per-job architecture)
          iterationNumber: 1,
          message,
          messageId: createdMessage.id,
          requestedAt: new Date().toISOString(),
          researchMode,
          rootMessageId: createdMessage.id,
          stateId: stateRecord.id,
          userId,
          // rootJobId will be set by worker to job.id since this is the first job
        },
        {
          jobId: createdMessage.id, // Use message ID as job ID for easy lookup
        }
      );

      activeConversationState = {
        id: conversationStateRecord.id,
        values: conversationStateRecord.values,
      };
      setDeepResearchActivity(activeConversationState.values, {
        level: activeConversationState.values.currentLevel,
        objective:
          activeConversationState.values.currentObjective ||
          activeConversationState.values.evolvingObjective ||
          activeConversationState.values.objective ||
          createdMessage.question ||
          message,
        phase: "planning",
      });
      // Keep queue mode fast: the worker generates the initial objective trace.
      await updateConversationState(activeConversationState.id!, activeConversationState.values);
      await notifyStateUpdated(job.id!, conversationId, activeConversationState.id!);

      try {
        await updateRunJobId({
          conversationStateId: conversationStateRecord.id,
          jobId: job.id!,
          rootMessageId: createdMessage.id,
          stateId: stateRecord.id,
        });
      } catch (error) {
        logger.warn(
          {
            conversationStateId: conversationStateRecord.id,
            error,
            jobId: job.id,
            messageId: createdMessage.id,
          },
          "deep_research_run_job_id_update_failed"
        );
      }

      logger.info(
        {
          conversationId,
          jobId: job.id,
          messageId: createdMessage.id,
        },
        "deep_research_job_enqueued"
      );

      const pollUrl = buildDeepResearchPollUrl(createdMessage.id);

      const response: DeepResearchQueuedResponse = {
        conversationId,
        jobId: job.id!,
        messageId: createdMessage.id,
        pollUrl,
        status: "queued",
        userId,
      };

      return new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        status: 202, // Accepted
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      // Status endpoint reads state.values.status to surface failure;
      // without this update GET /api/deep-research/status/:messageId would
      // keep reporting "processing" for a run that died before the worker
      // ever owned it.
      try {
        await updateState(stateRecord.id, {
          ...stateRecord.values,
          error: errorMessage,
          status: "failed",
        });
      } catch (stateErr) {
        logger.warn(
          { error: stateErr, stateId: stateRecord.id },
          "deep_research_state_mark_failed_on_queue_error"
        );
      }
      if (runMarkedStarted) {
        try {
          await markRunFinished({
            conversationStateId: conversationStateRecord.id,
            error: errorMessage,
            result: "failed",
            rootMessageId: createdMessage.id,
            stateId: stateRecord.id,
          });
        } catch (error) {
          logger.warn(
            { conversationStateId: conversationStateRecord.id, error },
            "deep_research_run_finish_mark_failed_on_queue_error"
          );
        }
      }
      throw err;
    }
  }

  // =========================================================================
  // IN-PROCESS MODE: Fire-and-forget async execution (existing behavior)
  // =========================================================================
  logger.info(
    { conversationId, messageId: createdMessage.id },
    "deep_research_using_in_process_mode"
  );

  // Return immediately with message ID
  const response: DeepResearchStartResponse = {
    conversationId,
    messageId: createdMessage.id,
    status: "processing",
    userId,
  };

  // Run the actual deep research in the background
  // Don't await - let it run asynchronously
  try {
    runDeepResearch({
      conversationStateId: conversationStateRecord.id,
      conversationStateRecord,
      createdMessage,
      files,
      researchMode,
      rootMessageId: createdMessage.id,
      stateRecord,
    }).catch((err) => {
      logger.error({ err, messageId: createdMessage.id }, "deep_research_background_failed");
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    // Synchronous failure before runDeepResearch's own try/catch fires.
    // The async failure handler doesn't run here, so the status endpoint
    // would otherwise keep reporting "processing" for a dead run.
    try {
      await updateState(stateRecord.id, {
        ...stateRecord.values,
        error: errorMessage,
        status: "failed",
      });
    } catch (stateErr) {
      logger.warn(
        { error: stateErr, stateId: stateRecord.id },
        "deep_research_state_mark_failed_on_in_process_start_error"
      );
    }
    if (runMarkedStarted) {
      try {
        await markRunFinished({
          conversationStateId: conversationStateRecord.id,
          error: errorMessage,
          result: "failed",
          rootMessageId: createdMessage.id,
          stateId: stateRecord.id,
        });
      } catch (error) {
        logger.warn(
          { conversationStateId: conversationStateRecord.id, error },
          "deep_research_run_finish_mark_failed_on_background_start_error"
        );
      }
    }
    throw err;
  }

  if (logger) {
    logger.info({ conversationId, messageId: createdMessage.id }, "deep_research_started");
  }

  return response;
}

/**
 * Background function that executes the deep research workflow
 *
 * Research modes:
 * - 'semi-autonomous' (default): Uses MAX_AUTO_ITERATIONS from env (default 5)
 * - 'fully-autonomous': Continues until research is done or hard cap of 20 iterations
 * - 'steering': Single iteration only, always asks user for feedback
 */
async function runDeepResearch(params: {
  stateRecord: DbState & { id: string };
  conversationStateRecord: DbConversationState & { id: string };
  createdMessage: CreatedMessage;
  files: File[];
  researchMode?: "semi-autonomous" | "fully-autonomous" | "steering";
  rootMessageId: string;
  conversationStateId: string;
}) {
  const {
    stateRecord,
    conversationStateRecord,
    createdMessage,
    files,
    researchMode = "semi-autonomous",
    rootMessageId,
    conversationStateId,
  } = params;
  let activeConversationState: ConversationState | null = null;
  let readCancellationRequested: () => Promise<boolean> = async () => false;

  try {
    // Initialize state
    const state: State = {
      id: stateRecord.id,
      values: buildMessageStateValues({
        baseValues: stateRecord.values,
        isDeepResearch: true,
        message: createdMessage,
      }),
    };

    // Initialize conversation state
    const conversationState: ConversationState = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };
    activeConversationState = conversationState;

    readCancellationRequested = async (): Promise<boolean> => {
      const latest = conversationState.id ? await getConversationState(conversationState.id) : null;
      return isDeepResearchCancellationRequested(latest?.values || conversationState.values, {
        rootMessageId,
        stateId: stateRecord.id,
      });
    };

    const assertNotCancelled = async () => {
      const latest = conversationState.id ? await getConversationState(conversationState.id) : null;
      throwIfDeepResearchCancelled(latest?.values || conversationState.values, {
        rootMessageId,
        stateId: stateRecord.id,
      });
    };

    await assertNotCancelled();

    // Step 1: Process files if any
    if (files.length > 0) {
      await assertNotCancelled();
      const fileResult = await fileUploadAgent({
        conversationState,
        files,
        userId: state.values.userId || "unknown",
      });

      logger.info(
        {
          errors: fileResult.errors,
          fileCount: files.length,
          uploadedDatasets: fileResult.uploadedDatasets,
        },
        "file_upload_agent_result"
      );
    }

    // =========================================================================
    // AUTONOMOUS ITERATION LOOP
    // Continues until: research is done, max iterations reached, or agent decides to ask user
    // =========================================================================
    const maxAutoIterations =
      researchMode === "steering"
        ? 1 // Steering mode: single iteration, always ask user
        : researchMode === "fully-autonomous"
          ? 20 // Fully autonomous: hard cap
          : parseInt(process.env.MAX_AUTO_ITERATIONS || "5"); // Semi-autonomous: configurable

    let iterationCount = 0;
    let shouldContinueLoop = true;

    // Variables that need to be accessible after the loop for reply generation
    let tasksToExecute: PlanTask[] = [];
    let hypothesisResult: { hypothesis: string; mode: string } = {
      hypothesis: "",
      mode: "create",
    };

    // Track the current message being updated (changes when auto-continuing)
    let currentMessage = createdMessage;
    type ConversationStateWriteOptions = {
      ensureTraceObjective?: string;
      completeTrace?: boolean;
      staleTrace?: boolean;
    };

    const prepareConversationStateForWrite = async (options?: ConversationStateWriteOptions) => {
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
      if (!conversationState.id) {
        return;
      }

      await prepareConversationStateForWrite(options);
      await updateConversationState(conversationState.id, conversationState.values);
    };

    const persistConversationActivity = async (
      params: Parameters<typeof setDeepResearchActivity>[1],
      options?: {
        write?: ((options?: ConversationStateWriteOptions) => Promise<any>) | null;
        notify?: boolean;
        ensureTraceObjective?: string;
      }
    ) => {
      if (!conversationState.id) {
        return;
      }

      setDeepResearchActivity(conversationState.values, params);

      if (options?.write) {
        await options.write({
          ensureTraceObjective: options.ensureTraceObjective,
        });
      } else {
        await persistConversationState({
          ensureTraceObjective: options?.ensureTraceObjective,
        });
      }

      if (options?.notify !== false) {
        await notifyStateUpdated(
          `in-process-${currentMessage.id}`,
          currentMessage.conversation_id,
          conversationState.id
        );
      }
    };

    const clearConversationActivity = async (options?: {
      completeTrace?: boolean;
      staleTrace?: boolean;
    }) => {
      if (!conversationState.id) {
        return;
      }

      clearDeepResearchActivity(conversationState.values);
      await persistConversationState({
        completeTrace: options?.completeTrace,
        staleTrace: options?.staleTrace,
      });
      await notifyStateUpdated(
        `in-process-${currentMessage.id}`,
        currentMessage.conversation_id,
        conversationState.id
      );
    };

    // Flag to skip planning when continuing (tasks already promoted)
    let skipPlanning = false;

    // Track starting level for this user interaction (to gather all tasks across continuations)
    const sessionStartLevel = calculateSessionStartLevel(conversationState.values.currentLevel);

    logger.info({ maxAutoIterations, researchMode }, "starting_autonomous_research_loop");

    while (shouldContinueLoop && iterationCount < maxAutoIterations) {
      await assertNotCancelled();
      try {
        await touchRun({
          conversationStateId,
          rootMessageId,
          stateId: stateRecord.id,
        });
      } catch (error) {
        logger.warn(
          { conversationStateId, error, rootMessageId },
          "deep_research_run_heartbeat_failed_at_iteration_start"
        );
      }

      iterationCount++;
      const iterationStartTime = Date.now();
      logger.info({ iterationCount, maxAutoIterations }, "starting_iteration");

      if (!skipPlanning) {
        await assertNotCancelled();
        await persistConversationActivity(
          {
            level: conversationState.values.currentLevel,
            objective:
              conversationState.values.currentObjective ||
              conversationState.values.evolvingObjective ||
              conversationState.values.objective ||
              currentMessage.question ||
              createdMessage.question,
            phase: "planning",
          },
          {
            ensureTraceObjective: getObjectiveTraceObjective(
              conversationState.values,
              currentMessage.question || createdMessage.question
            ),
          }
        );
      }

      // Planning (shared phase) — 3 paths: continuation / clarification / initial.
      const planning = await runPlanningPhase(
        {
          conversationState,
          currentMessage,
          iterationCount,
          researchMode,
          rootMessage: createdMessage,
          skipPlanning,
          state,
        },
        {
          assertNotCancelled,
          getObjectiveTraceObjective,
          persistConversationState,
        }
      );
      const newLevel: number = planning.newLevel;
      const currentObjective: string = planning.currentObjective;
      skipPlanning = planning.nextSkipPlanning;

      // Execute only tasks from the current level
      tasksToExecute = (conversationState.values.plan || []).filter((t) => t.level === newLevel);

      // Serialize DB writes to prevent concurrent updateConversationState calls
      // from overwriting each other's changes during the parallel fan-out.
      let stateWriteChain = Promise.resolve();
      const writeStateSerialized = async (options?: ConversationStateWriteOptions) => {
        const p = stateWriteChain.then(async () => {
          await prepareConversationStateForWrite(options);
          return updateConversationState(conversationState.id!, conversationState.values);
        });
        stateWriteChain = p.catch((err) => {
          logger.error(
            { conversationStateId: conversationState.id, err, rootMessageId },
            "state_write_chain_error_suppressed"
          );
        });
        return p;
      };

      // Execution (shared phase) — fans out literature + analysis tasks
      // through the serialized write chain.
      await runExecutionPhase(
        {
          conversationState,
          newLevel,
          tasksToExecute,
          userId: createdMessage.user_id,
        },
        {
          assertNotCancelled,
          notifyStateUpdated: async () => {
            if (!conversationState.id) return;
            await notifyStateUpdated(
              `in-process-${currentMessage.id}`,
              createdMessage.conversation_id,
              conversationState.id
            );
          },
          writeStateSerialized: () => writeStateSerialized(),
        }
      );

      // Inline fan-out was migrated to runExecutionPhase above.

      await persistConversationActivity({
        level: newLevel,
        objective: currentObjective || conversationState.values.currentObjective,
        phase: "reflection",
      });

      // Step 3: Generate/update hypothesis based on completed tasks
      hypothesisResult = await runHypothesisPhase(
        {
          completedTasks: tasksToExecute, // All tasks from current level
          conversationState,
          message: createdMessage,
          objective: currentObjective,
        },
        { assertNotCancelled, persistConversationState }
      );

      // Step 4: Run reflection + discovery (shared phase)
      await runReflectionDiscoveryPhase(
        {
          completedTasks: tasksToExecute,
          conversationState,
          hypothesis: hypothesisResult.hypothesis,
          message: createdMessage,
        },
        { assertNotCancelled, getObjectiveTraceObjective, persistConversationState }
      );

      // Step 5: Run planning agent in "next" mode to plan next iteration
      await assertNotCancelled();
      logger.info("running_next_planning_for_future_iteration");

      // Step 5: Plan next iteration (shared phase)
      const nextStepsResult = await runNextStepsPhase(
        {
          conversationState,
          currentObjective,
          message: createdMessage,
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

      if (!nextStepsResult.hasSuggestions) {
        shouldContinueLoop = false;
      }

      // Continue-research decision (shared phase)
      const continueDecision = await runContinueDecisionPhase(
        {
          completedTasks: tasksToExecute,
          conversationState,
          hypothesis: hypothesisResult.hypothesis,
          iterationCount,
          loopAlive: shouldContinueLoop,
          maxAutoIterations,
          message: currentMessage,
          researchMode,
        },
        { assertNotCancelled }
      );
      const { isFinal, willContinue } = continueDecision;
      shouldContinueLoop = continueDecision.shouldContinueLoop;

      // Reply (shared phase)
      logger.info(
        { isFinal, iterationCount, messageId: currentMessage.id },
        "generating_reply_for_iteration"
      );
      const { markMessageComplete } = await import("../../services/chat/tools");
      await runReplyPhase(
        {
          conversationState,
          currentMessage,
          currentObjective,
          hypothesis: hypothesisResult.hypothesis,
          isFinal,
          iterationCount,
          iterationStartTime,
          newLevel,
          sessionStartLevel,
          state,
        },
        {
          assertNotCancelled,
          markMessageComplete,
          notifyMessageUpdated: async () => {
            await notifyMessageUpdated(
              `in-process-${currentMessage.id}`,
              currentMessage.conversation_id,
              currentMessage.id
            );
          },
          persistConversationActivity,
          persistConversationState,
        }
      );

      try {
        await touchRun({
          conversationStateId,
          rootMessageId,
          stateId: stateRecord.id,
        });
      } catch (error) {
        logger.warn(
          { conversationStateId, error, rootMessageId },
          "deep_research_run_heartbeat_failed_after_iteration_reply"
        );
      }

      // Prepare next iteration (shared phase) — only when continuing
      if (willContinue) {
        skipPlanning = true; // Next iteration uses promoted tasks
        logger.info({ iterationCount }, "auto_continuing_to_next_iteration");

        const continuation = await runContinuationPrepPhase(
          {
            conversationState,
            currentMessage,
            currentObjective,
            stateId: stateRecord.id,
            userMessage: currentMessage.question || createdMessage.question || "",
          },
          {
            assertNotCancelled,
            getObjectiveTraceObjective,
            persistConversationActivity,
          }
        );

        // In-process mode loops in memory; advance currentMessage so the
        // next iteration writes to the freshly created agent message.
        currentMessage = continuation.newMessage;
      }
    } // END OF WHILE LOOP

    // =========================================================================
    // END OF AUTONOMOUS LOOP
    // =========================================================================
    logger.info(
      { finalMessageId: currentMessage.id, totalIterations: iterationCount },
      "autonomous_loop_completed"
    );

    logger.info(
      {
        conversationId: createdMessage.conversation_id,
        finalMessageId: currentMessage.id,
        originalMessageId: createdMessage.id,
        totalIterations: iterationCount,
      },
      "deep_research_completed"
    );

    await clearConversationActivity({ completeTrace: true });

    try {
      await markRunFinished({
        conversationStateId,
        result: "completed",
        rootMessageId,
        stateId: stateRecord.id,
      });
    } catch (error) {
      logger.warn(
        { conversationStateId, error, rootMessageId },
        "deep_research_run_finish_mark_failed_on_success"
      );
    }
  } catch (err) {
    if (err instanceof DeepResearchCancelledError || (await readCancellationRequested())) {
      logger.info({ messageId: createdMessage.id }, "deep_research_in_process_cancelled");
      if (activeConversationState?.id) {
        await notifyStateUpdated(
          `in-process-${createdMessage.id || stateRecord.id}`,
          createdMessage.conversation_id,
          activeConversationState.id
        );
      }
      return;
    }

    logger.error({ err, messageId: createdMessage.id }, "deep_research_execution_failed");

    await handleDeepResearchStartFailure({
      activeConversationState,
      conversationId: createdMessage.conversation_id,
      conversationStateId,
      err,
      notificationJobId: `in-process-${createdMessage.id || stateRecord.id}`,
      rootMessageId,
      stateRecord,
    });
  }
}
