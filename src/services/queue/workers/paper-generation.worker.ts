/**
 * Paper Generation Worker for BullMQ
 *
 * Processes paper generation jobs from the queue.
 * Generates LaTeX papers from Deep Research conversations and compiles them to PDF.
 */

import { Worker, Job } from "bullmq";
import { getBullMQConnection } from "../connection";
import {
  notifyPaperStarted,
  notifyPaperProgress,
  notifyPaperCompleted,
  notifyPaperFailed,
} from "../notify";
import type {
  PaperGenerationJobData,
  PaperGenerationJobResult,
  PaperGenerationStage,
  JobProgress,
} from "../types";
import logger from "../../../utils/logger";

/**
 * Progress stage percentages
 */
const STAGE_PROGRESS: Record<PaperGenerationStage, number> = {
  validating: 5,
  metadata: 20,
  figures: 30,
  discoveries: 60,
  bibliography: 75,
  latex_assembly: 80,
  compilation: 90,
  upload: 95,
  cleanup: 100,
};

/**
 * Process a paper generation job
 */
async function processPaperGenerationJob(
  job: Job<PaperGenerationJobData, PaperGenerationJobResult>,
): Promise<PaperGenerationJobResult> {
  const startTime = Date.now();
  const { paperId, userId, conversationId } = job.data;

  logger.info(
    { jobId: job.id, paperId, conversationId },
    "paper_generation_job_started",
  );

  // Update paper status in DB to 'processing'
  // Use service client to bypass RLS - worker has no JWT context
  const { getServiceClient } = await import("../../../db/client");
  const supabase = getServiceClient();

  await supabase
    .from("paper")
    .update({ status: "processing", job_id: job.id })
    .eq("id", paperId);

  // Notify: Job started
  await notifyPaperStarted(job.id!, conversationId, paperId);

  try {
    // Progress callback to update job progress and send notifications
    const onProgress = async (stage: PaperGenerationStage) => {
      const percent = STAGE_PROGRESS[stage] || 0;
      await job.updateProgress({ stage, percent } as JobProgress);
      await notifyPaperProgress(job.id!, conversationId, paperId, stage, percent);

      // Update progress in DB
      await supabase
        .from("paper")
        .update({ progress: { stage, percent } })
        .eq("id", paperId);

      logger.info(
        { jobId: job.id, paperId, stage, percent },
        "paper_generation_progress",
      );
    };

    // Import and call the paper generation service
    const { generatePaperFromConversation } = await import(
      "../../../services/paper/generatePaper"
    );

    const result = await generatePaperFromConversation(
      conversationId,
      userId,
      paperId, // Pass pre-created paperId
      onProgress, // Progress callback
    );

    // Update paper status in DB to 'completed'
    await supabase
      .from("paper")
      .update({
        status: "completed",
        progress: { stage: "cleanup", percent: 100 },
        pdf_path: result.pdfPath,
      })
      .eq("id", paperId);

    const responseTime = Date.now() - startTime;

    logger.info(
      { jobId: job.id, paperId, responseTime },
      "paper_generation_job_completed",
    );

    // Notify: Job completed
    await notifyPaperCompleted(job.id!, conversationId, paperId);

    return {
      paperId,
      conversationId,
      pdfPath: result.pdfPath,
      pdfUrl: result.pdfUrl,
      rawLatexUrl: result.rawLatexUrl,
      status: "completed",
      responseTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      { jobId: job.id, paperId, error: errorMessage },
      "paper_generation_job_failed",
    );

    // Update paper status in DB to 'failed'
    await supabase
      .from("paper")
      .update({ status: "failed", error: errorMessage })
      .eq("id", paperId);

    // Notify: Job failed
    await notifyPaperFailed(job.id!, conversationId, paperId, errorMessage);

    throw error;
  }
}

/**
 * Start the paper generation worker
 */
export function startPaperGenerationWorker(): Worker {
  const concurrency = parseInt(process.env.PAPER_GENERATION_CONCURRENCY || "1");

  const worker = new Worker<PaperGenerationJobData, PaperGenerationJobResult>(
    "paper-generation",
    processPaperGenerationJob,
    {
      connection: getBullMQConnection(),
      concurrency,
      // Paper generation can take 30-60 minutes
      // lockRenewTime must be significantly less than lockDuration (1/6 ratio)
      lockDuration: 3600000, // 1 hour
      lockRenewTime: 600000, // 10 minutes - renew well before lock expires
      stalledInterval: 1800000, // 30 minutes
    },
  );

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, paperId: result.paperId, responseTime: result.responseTime },
      "paper_generation_worker_job_completed",
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        error: error.message,
      },
      "paper_generation_worker_job_failed",
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "paper_generation_worker_job_stalled");
  });

  logger.info({ concurrency }, "paper_generation_worker_started");

  return worker;
}
