/**
 * Admin Jobs API - Query BullMQ job status directly
 * 
 * Provides REST API access to BullMQ job data for the frontend dashboard.
 * Requires admin authentication via X-Admin-Key header.
 */

import { Elysia } from "elysia";
import { isJobQueueEnabled } from "../../services/queue/connection";
import {
  getChatQueue,
  getDeepResearchQueue,
  getFileProcessQueue,
  getPaperGenerationQueue,
} from "../../services/queue/queues";
import type { Queue, Job } from "bullmq";
import logger from "../../utils/logger";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || process.env.ADMIN_PASSWORD;

interface JobResponse {
  id: string;
  name: string;
  data: Record<string, unknown>;
  state: string;
  progress: unknown;
  attemptsMade: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  timestamp: number;
}

/**
 * Get queue by name
 */
function getQueue(name: string): Queue | null {
  if (!isJobQueueEnabled()) {
    return null;
  }

  switch (name) {
    case "chat":
      return getChatQueue();
    case "deep-research":
      return getDeepResearchQueue();
    case "file-process":
      return getFileProcessQueue();
    case "paper-generation":
      return getPaperGenerationQueue();
    default:
      return null;
  }
}

/**
 * Convert BullMQ job to response format
 */
async function jobToResponse(job: Job): Promise<JobResponse> {
  const state = await job.getState();
  return {
    id: job.id || "",
    name: job.name,
    data: job.data as Record<string, unknown>,
    state,
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
    timestamp: job.timestamp,
  };
}

/**
 * Admin Jobs Route
 */
export const adminJobsRoute = new Elysia().guard(
  {
    beforeHandle: ({ request, set }) => {
      // Check admin auth
      const adminKey = request.headers.get("x-admin-key");
      if (!ADMIN_API_KEY || adminKey !== ADMIN_API_KEY) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
    },
  },
  (app) =>
    app
      .get("/api/admin/jobs", async ({ query, set }) => {
        const queueName = (query.queue as string) || "deep-research";
        const status = (query.status as string) || "all";
        const limit = parseInt((query.limit as string) || "50");

        if (!isJobQueueEnabled()) {
          set.status = 503;
          return {
            error: "Job queue not enabled",
            message: "Set USE_JOB_QUEUE=true to enable job queues",
          };
        }

        const queue = getQueue(queueName);
        if (!queue) {
          set.status = 404;
          return { error: `Queue '${queueName}' not found` };
        }

        try {
          // Get queue counts
          const counts = await queue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed",
            "delayed"
          );

          // Get jobs based on status filter
          let jobs: Job[] = [];

          if (status === "all" || status === "active") {
            const active = await queue.getActive(0, limit);
            jobs = jobs.concat(active);
          }
          if (status === "all" || status === "waiting") {
            const waiting = await queue.getWaiting(0, limit);
            jobs = jobs.concat(waiting);
          }
          if (status === "all" || status === "completed") {
            const completed = await queue.getCompleted(0, limit);
            jobs = jobs.concat(completed);
          }
          if (status === "all" || status === "failed") {
            const failed = await queue.getFailed(0, limit);
            jobs = jobs.concat(failed);
          }
          if (status === "all" || status === "delayed") {
            const delayed = await queue.getDelayed(0, limit);
            jobs = jobs.concat(delayed);
          }

          // Sort by timestamp (newest first) and limit
          jobs = jobs
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);

          // Convert to response format
          const jobResponses = await Promise.all(jobs.map(jobToResponse));

          logger.info(
            { queue: queueName, status, jobCount: jobResponses.length },
            "admin_jobs_fetched"
          );

          return {
            queue: queueName,
            jobs: jobResponses,
            counts,
          };
        } catch (error) {
          logger.error({ error, queue: queueName }, "admin_jobs_fetch_error");
          set.status = 500;
          return { error: "Failed to fetch jobs" };
        }
      })

      // Get single job details
      .get("/api/admin/jobs/:jobId", async ({ params, query, set }) => {
        const { jobId } = params;
        const queueName = (query.queue as string) || "deep-research";

        if (!isJobQueueEnabled()) {
          set.status = 503;
          return { error: "Job queue not enabled" };
        }

        const queue = getQueue(queueName);
        if (!queue) {
          set.status = 404;
          return { error: `Queue '${queueName}' not found` };
        }

        const job = await queue.getJob(jobId);
        if (!job) {
          set.status = 404;
          return { error: "Job not found" };
        }

        return await jobToResponse(job);
      })

      // Retry a failed job
      .post("/api/admin/jobs/:jobId/retry", async ({ params, query, set }) => {
        const { jobId } = params;
        const queueName = (query.queue as string) || "deep-research";

        if (!isJobQueueEnabled()) {
          set.status = 503;
          return { error: "Job queue not enabled" };
        }

        const queue = getQueue(queueName);
        if (!queue) {
          set.status = 404;
          return { error: `Queue '${queueName}' not found` };
        }

        const job = await queue.getJob(jobId);
        if (!job) {
          set.status = 404;
          return { error: "Job not found" };
        }

        const state = await job.getState();
        if (state !== "failed") {
          set.status = 400;
          return { error: `Cannot retry job in state '${state}'` };
        }

        await job.retry();

        logger.info({ jobId, queue: queueName }, "admin_job_retried");

        return { success: true, jobId, message: "Job queued for retry" };
      })
);
