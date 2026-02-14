import { Elysia } from "elysia";
import { getMessage, getState } from "../../db/operations";
import { authResolver } from "../../middleware/authResolver";
import {
  acquireStartMutex,
  getActiveRunForDedup,
  markRunFinished,
  markRunStarted,
  releaseStartMutex,
} from "../../services/deep-research/run-guard";
import type { AuthContext } from "../../types/auth";
import logger from "../../utils/logger";

type DeepResearchStatusResponse = {
  status: "processing" | "completed" | "failed";
  messageId: string;
  conversationId: string;
  result?: {
    text: string;
    files?: Array<{
      filename: string;
      mimeType: string;
      size?: number;
    }>;
    papers?: any[];
    webSearchResults?: any[];
  };
  error?: string;
  progress?: {
    currentStep?: string;
    completedSteps?: string[];
  };
};

/**
 * Deep Research Status Route - Check progress of a deep research job
 *
 * Security measures:
 * - Authentication always required
 * - Ownership validation (user can only access their own messages)
 */
export const deepResearchStatusRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true, // Always require auth - no environment-based bypass
      }),
    ],
  },
  (app) =>
    app
      .get("/api/deep-research/status/:messageId", deepResearchStatusHandler)
      .post("/api/deep-research/retry/:jobId", deepResearchRetryHandler)
);

/**
 * Deep Research Status Handler - Core logic for GET /api/deep-research/status/:messageId
 * Exported for reuse in x402 routes
 */
export async function deepResearchStatusHandler(ctx: any) {
  const { params, set, request } = ctx;
  const messageId = params.messageId;

  // SECURITY: Get userId ONLY from authenticated context - never from query params
  const auth = (request as any).auth as AuthContext | undefined;

  if (!auth?.userId) {
    set.status = 401;
    return {
      ok: false,
      error: "Authentication required",
      message: "Please provide a valid JWT or API key",
    };
  }

  const userId = auth.userId;

  if (!messageId) {
    set.status = 400;
    return {
      ok: false,
      error: "Missing required parameter: messageId",
    };
  }

  logger.info(
    {
      messageId,
      userId,
      authMethod: auth.method,
      verified: auth.verified,
    },
    "deep_research_status_check"
  );

  try {
    // Fetch the message
    const message = await getMessage(messageId);
    if (!message) {
      set.status = 404;
      return {
        ok: false,
        error: "Message not found",
      };
    }

    // SECURITY: Ownership validation - user can only access their own messages
    if (message.user_id !== userId) {
      logger.warn(
        { messageId, requestedBy: userId, ownedBy: message.user_id },
        "deep_research_status_ownership_mismatch"
      );
      set.status = 403;
      return {
        ok: false,
        error: "Access denied: message belongs to another user",
      };
    }

    // Fetch the state
    const stateId = message.state_id;
    if (!stateId) {
      set.status = 500;
      return {
        ok: false,
        error: "Message has no associated state",
      };
    }

    const state = await getState(stateId);
    if (!state) {
      set.status = 404;
      return {
        ok: false,
        error: "State not found",
      };
    }

    // Determine status based on state values
    const stateValues = state.values || {};
    const steps = stateValues.steps || {};

    // Check if there's an error
    if (stateValues.status === "failed" || stateValues.error) {
      const response: DeepResearchStatusResponse = {
        status: "failed",
        messageId,
        conversationId: message.conversation_id,
        error: stateValues.error || "Deep research failed",
      };
      return response;
    }

    // Check if completed (finalResponse exists and no active steps)
    const hasActiveSteps = Object.values(steps).some(
      (step: any) => step.start && !step.end
    );

    if (stateValues.finalResponse && !hasActiveSteps) {
      // Completed
      const rawFiles = stateValues.rawFiles;
      const fileMetadata =
        rawFiles?.length > 0
          ? rawFiles.map((f: any) => ({
              filename: f.filename,
              mimeType: f.mimeType,
              size: f.metadata?.size,
            }))
          : undefined;

      // Get unique papers from various sources
      const papers = [
        ...(stateValues.finalPapers || []),
        ...(stateValues.openScholarPapers || []),
        ...(stateValues.semanticScholarPapers || []),
        ...(stateValues.kgPapers || []),
      ];

      const response: DeepResearchStatusResponse = {
        status: "completed",
        messageId,
        conversationId: message.conversation_id,
        result: {
          text: stateValues.finalResponse,
          files: fileMetadata,
          papers: papers.length > 0 ? papers : undefined,
          webSearchResults: stateValues.webSearchResults,
        },
      };
      return response;
    }

    // Still processing
    const completedSteps = Object.keys(steps).filter(
      (stepName) => steps[stepName].end
    );
    const currentStep = Object.keys(steps).find(
      (stepName) => steps[stepName].start && !steps[stepName].end
    );

    const response: DeepResearchStatusResponse = {
      status: "processing",
      messageId,
      conversationId: message.conversation_id,
      progress: {
        currentStep,
        completedSteps,
      },
    };

    return response;
  } catch (err) {
    logger.error({ err, messageId }, "deep_research_status_check_failed");
    set.status = 500;
    return {
      ok: false,
      error: "Failed to check deep research status",
    };
  }
}

/**
 * Deep Research Retry Handler - Manually retry a failed job
 * POST /api/deep-research/retry/:jobId
 *
 * Security: Validates that the authenticated user owns the job being retried
 */
async function deepResearchRetryHandler(ctx: any) {
  const { params, set, request } = ctx;
  const { jobId } = params;

  // SECURITY: Get authenticated user
  const auth = (request as any).auth as AuthContext | undefined;

  if (!auth?.userId) {
    set.status = 401;
    return {
      ok: false,
      error: "Authentication required",
      message: "Please provide a valid JWT or API key",
    };
  }

  const userId = auth.userId;

  const { isJobQueueEnabled } = await import("../../services/queue/connection");

  if (!isJobQueueEnabled()) {
    set.status = 404;
    return {
      error: "Job queue not enabled",
      message: "Retry endpoint only available when USE_JOB_QUEUE=true",
    };
  }

  const { getDeepResearchQueue } = await import("../../services/queue/queues");
  const deepResearchQueue = getDeepResearchQueue();

  const job = await deepResearchQueue.getJob(jobId);

  if (!job) {
    set.status = 404;
    return {
      ok: false,
      error: "Job not found",
    };
  }

  // SECURITY: Verify the authenticated user owns this job
  if (job.data.userId !== userId) {
    logger.warn(
      { jobId, requestedBy: userId, ownedBy: job.data.userId },
      "deep_research_retry_ownership_mismatch"
    );
    set.status = 403;
    return {
      ok: false,
      error: "Access denied: job belongs to another user",
    };
  }

  const state = await job.getState();

  // Only allow retry for failed jobs
  if (state !== "failed") {
    set.status = 400;
    return {
      ok: false,
      error: `Cannot retry job in state '${state}'`,
      message: "Only failed jobs can be manually retried",
    };
  }

  const conversationStateId = job.data.conversationStateId;
  const stateId = job.data.stateId;
  const rootMessageId = job.data.rootMessageId || job.data.messageId;

  if (!conversationStateId || !stateId || !rootMessageId) {
    set.status = 500;
    return {
      ok: false,
      error: "Job missing conversation run metadata for retry",
    };
  }

  const startMutex = await acquireStartMutex(conversationStateId);
  if (!startMutex.acquired && !startMutex.fallback) {
    logger.warn(
      { jobId, conversationStateId },
      "deep_research_retry_proceeding_without_mutex",
    );
  }

  try {
    const activeRun = await getActiveRunForDedup(conversationStateId);
    if (activeRun) {
      set.status = 409;
      return {
        ok: false,
        error: "Deep research is already running for this conversation",
        messageId: activeRun.messageId,
        jobId: activeRun.jobId,
      };
    }

    await markRunStarted({
      conversationStateId,
      rootMessageId,
      stateId,
      mode: "queue",
      jobId: job.id!,
    });
  } finally {
    await releaseStartMutex(startMutex);
  }

  try {
    // Retry the job - moves it back to waiting state
    await job.retry();

    logger.info(
      {
        jobId,
        userId,
        previousAttempts: job.attemptsMade,
      },
      "deep_research_job_manually_retried"
    );

    return {
      ok: true,
      jobId,
      status: "retrying",
      message: "Job has been queued for retry",
      previousAttempts: job.attemptsMade,
    };
  } catch (error) {
    try {
      await markRunFinished({
        conversationStateId,
        result: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        rootMessageId,
        stateId,
      });
    } catch (finishError) {
      logger.warn(
        { finishError, conversationStateId, rootMessageId, stateId },
        "deep_research_retry_finish_mark_failed_on_retry_error",
      );
    }

    logger.error({ error, jobId }, "deep_research_manual_retry_failed");
    set.status = 500;
    return {
      ok: false,
      error: "Failed to retry job",
    };
  }
}
