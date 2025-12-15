import { Elysia } from "elysia";
import { getMessage, getState } from "../../db/operations";
import { authResolver } from "../../middleware/authResolver";
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
 * Uses guard pattern to ensure auth runs for all routes
 */
export const deepResearchStatusRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: process.env.NODE_ENV === "production",
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
  const { params, query, set, request } = ctx;
  const messageId = params.messageId;

  // Get userId from auth context (set by authResolver middleware)
  // Fallback to query.userId for backward compatibility
  const auth = (request as any).auth as AuthContext | undefined;
  const userId = auth?.userId || query.userId;

    if (!messageId) {
      set.status = 400;
      return {
        ok: false,
        error: "Missing required parameter: messageId",
      };
    }

    if (!userId) {
      set.status = 400;
      return {
        ok: false,
        error: "Missing required query parameter: userId (or provide valid authentication)",
      };
    }

    logger.info(
      {
        messageId,
        userId,
        authMethod: auth?.method || "query",
        verified: auth?.verified || false,
      },
      "deep_research_status_check",
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

      // Ownership validation: ensure message belongs to the requesting user
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
        (step: any) => step.start && !step.end,
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
        (stepName) => steps[stepName].end,
      );
      const currentStep = Object.keys(steps).find(
        (stepName) => steps[stepName].start && !steps[stepName].end,
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
 */
async function deepResearchRetryHandler(ctx: any) {
  const { params, set } = ctx;
  const { jobId } = params;

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
      error: "Job not found"
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
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
