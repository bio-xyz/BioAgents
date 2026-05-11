/**
 * Paper Generation Worker for BullMQ
 *
 * Processes paper generation jobs from the queue.
 * Generates LaTeX papers from Deep Research conversations and compiles them to PDF.
 */

import { Job, Worker } from "bullmq";
import logger from "../../../utils/logger";
import { getBullMQConnection } from "../connection";
import {
  notifyPaperCompleted,
  notifyPaperFailed,
  notifyPaperProgress,
  notifyPaperStarted,
} from "../notify";
import type {
  JobProgress,
  PaperGenerationJobData,
  PaperGenerationJobResult,
  PaperGenerationStage,
} from "../types";

/**
 * Progress stage percentages
 */
const STAGE_PROGRESS: Record<PaperGenerationStage, number> = {
  bibliography: 75,
  cleanup: 100,
  compilation: 90,
  discoveries: 60,
  figures: 30,
  latex_assembly: 80,
  metadata: 20,
  upload: 95,
  validating: 5,
};

/**
 * Process a paper generation job
 */
async function processPaperGenerationJob(
  job: Job<PaperGenerationJobData, PaperGenerationJobResult>
): Promise<PaperGenerationJobResult> {
  const startTime = Date.now();
  const { paperId, userId, conversationId } = job.data;

  logger.info({ conversationId, jobId: job.id, paperId }, "paper_generation_job_started");

  // Update paper status in DB to 'processing'
  // Use service client to bypass RLS - worker has no JWT context
  const { getServiceClient } = await import("../../../db/client");
  const supabase = getServiceClient();

  await supabase.from("paper").update({ job_id: job.id, status: "processing" }).eq("id", paperId);

  // Notify: Job started
  await notifyPaperStarted(job.id!, conversationId, paperId);

  try {
    // Progress callback to update job progress and send notifications
    const onProgress = async (stage: PaperGenerationStage) => {
      const percent = STAGE_PROGRESS[stage] || 0;
      await job.updateProgress({ percent, stage } as JobProgress);
      await notifyPaperProgress(job.id!, conversationId, paperId, stage, percent);

      // Update progress in DB
      await supabase.from("paper").update({ progress: { percent, stage } }).eq("id", paperId);

      logger.info({ jobId: job.id, paperId, percent, stage }, "paper_generation_progress");
    };

    // Import and call the paper generation service
    const { generatePaperFromConversation } = await import("../../../services/paper/generatePaper");

    const result = await generatePaperFromConversation(
      conversationId,
      userId,
      paperId, // Pass pre-created paperId
      onProgress // Progress callback
    );

    // Update paper status in DB to 'completed'
    await supabase
      .from("paper")
      .update({
        pdf_path: result.pdfPath,
        progress: { percent: 100, stage: "cleanup" },
        status: "completed",
      })
      .eq("id", paperId);

    const responseTime = Date.now() - startTime;

    logger.info({ jobId: job.id, paperId, responseTime }, "paper_generation_job_completed");

    // Notify: Job completed
    await notifyPaperCompleted(job.id!, conversationId, paperId);

    return {
      conversationId,
      paperId,
      pdfPath: result.pdfPath,
      pdfUrl: result.pdfUrl,
      rawLatexUrl: result.rawLatexUrl,
      responseTime,
      status: "completed",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error({ error: errorMessage, jobId: job.id, paperId }, "paper_generation_job_failed");

    // Update paper status in DB to 'failed'
    await supabase
      .from("paper")
      .update({ error: errorMessage, status: "failed" })
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
      concurrency,
      connection: getBullMQConnection(),
      // Paper generation can take 30-60 minutes
      // lockRenewTime must be significantly less than lockDuration (1/6 ratio)
      lockDuration: 3600000, // 1 hour
      lockRenewTime: 600000, // 10 minutes - renew well before lock expires
      stalledInterval: 1800000, // 30 minutes
    }
  );

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, paperId: result.paperId, responseTime: result.responseTime },
      "paper_generation_worker_job_completed"
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        error: error.message,
        jobId: job?.id,
      },
      "paper_generation_worker_job_failed"
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "paper_generation_worker_job_stalled");
  });

  logger.info({ concurrency }, "paper_generation_worker_started");

  return worker;
}
