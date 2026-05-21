/**
 * Paper generation worker for BullMQ.
 *
 * Thin adapter around runPaperGenerationLifecycle: writes the worker-only
 * job_id back to the paper row, wires BullMQ progress + pub/sub
 * notifications via lifecycle hooks, returns the lifecycle result.
 */

import { Job, Worker } from "bullmq";
import logger from "../../../utils/logger";
import { runPaperGenerationLifecycle } from "../../paper/lifecycle";
import { getBullMQConnection } from "../connection";
import {
  notifyPaperCompleted,
  notifyPaperFailed,
  notifyPaperProgress,
  notifyPaperStarted,
} from "../notify";
import type { JobProgress, PaperGenerationJobData, PaperGenerationJobResult } from "../types";

async function processPaperGenerationJob(
  job: Job<PaperGenerationJobData, PaperGenerationJobResult>
): Promise<PaperGenerationJobResult> {
  const { paperId, userId, conversationId } = job.data;

  logger.info({ conversationId, jobId: job.id, paperId }, "paper_generation_job_started");

  // Worker-only: link the BullMQ job id back to the paper row AND flip
  // status to "processing" atomically so the paper:started notification
  // fires after the row is already in the expected state (clients use the
  // notify+fetch pattern).
  const { getServiceClient } = await import("../../../db/client");
  const supabase = getServiceClient();
  const { error: startErr } = await supabase
    .from("paper")
    .update({ job_id: job.id, status: "processing" })
    .eq("id", paperId);
  if (startErr) {
    logger.error({ error: startErr, jobId: job.id, paperId }, "paper_worker_start_update_failed");
    throw startErr;
  }

  await notifyPaperStarted(job.id!, conversationId, paperId);

  const result = await runPaperGenerationLifecycle(
    { conversationId, paperId, userId },
    {
      onError: async ({ errorMessage }) => {
        logger.error(
          { error: errorMessage, jobId: job.id, paperId },
          "paper_generation_job_failed"
        );
        await notifyPaperFailed(job.id!, conversationId, paperId, errorMessage);
      },
      onProgress: async ({ stage, percent }) => {
        await job.updateProgress({ percent, stage } as JobProgress);
        await notifyPaperProgress(job.id!, conversationId, paperId, stage, percent);
        logger.info({ jobId: job.id, paperId, percent, stage }, "paper_generation_progress");
      },
      onSuccess: async ({ responseTime }) => {
        logger.info({ jobId: job.id, paperId, responseTime }, "paper_generation_job_completed");
        await notifyPaperCompleted(job.id!, conversationId, paperId);
      },
    }
  );

  return {
    conversationId,
    paperId,
    pdfPath: result.pdfPath,
    pdfUrl: result.pdfUrl,
    rawLatexUrl: result.rawLatexUrl,
    responseTime: result.responseTime,
    status: "completed",
  };
}

export function startPaperGenerationWorker(): Worker {
  const concurrency = parseInt(process.env.PAPER_GENERATION_CONCURRENCY || "1");

  const worker = new Worker<PaperGenerationJobData, PaperGenerationJobResult>(
    "paper-generation",
    processPaperGenerationJob,
    {
      concurrency,
      connection: getBullMQConnection(),
      // Paper generation can take 30-60 minutes
      // lockRenewTime must be significantly less than lockDuration (1/6 ratio)
      lockDuration: 3600000,
      lockRenewTime: 600000,
      stalledInterval: 1800000,
    }
  );

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, paperId: result.paperId, responseTime: result.responseTime },
      "paper_generation_worker_job_completed"
    );
  });

  worker.on("failed", (job, error) => {
    logger.error({ error: error.message, jobId: job?.id }, "paper_generation_worker_job_failed");
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "paper_generation_worker_job_stalled");
  });

  logger.info({ concurrency }, "paper_generation_worker_started");

  return worker;
}
