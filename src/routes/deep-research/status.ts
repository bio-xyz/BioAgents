import { Elysia } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import type { AuthContext } from "../../types/auth";
import { getDeepResearchStatus } from "./statusUtils";
import logger from "../../utils/logger";

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
 * Exported for reuse in b402 routes (which still use this handler)
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
    // Use shared status utility for message + state fetching and status detection
    const { response, httpStatus, message } =
      await getDeepResearchStatus(messageId);

    // If the message wasn't found or state error, return early
    if (!message) {
      set.status = httpStatus;
      return response;
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

    set.status = httpStatus;
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
    logger.error({ error, jobId }, "deep_research_manual_retry_failed");
    set.status = 500;
    return {
      ok: false,
      error: "Failed to retry job",
    };
  }
}
