/**
 * File Process Worker
 * Processes uploaded files: generates AI description and updates conversation state
 */

import { Worker, Job } from "bullmq";
import { getBullMQConnection } from "../connection";
import { publishNotification } from "../notify";
import type { FileProcessJobData, FileProcessJobResult } from "../types";
import logger from "../../../utils/logger";

/**
 * Process a file: download preview, generate description, update state
 */
async function processFileJob(
  job: Job<FileProcessJobData, FileProcessJobResult>,
): Promise<FileProcessJobResult> {
  const { fileId, filename, conversationId, userId, conversationStateId, s3Key, contentType, size } = job.data;

  logger.info(
    { jobId: job.id, fileId, filename },
    "file_process_job_started",
  );

  try {
    // Import processFile from file service
    const { processFile } = await import("../../files");
    const { updateFileStatus, getFileStatus } = await import("../../files/status");

    // Try to get current file status from Redis, but don't fail if it's missing
    // (status may have expired due to TTL after Docker redeploy or long retry delays)
    let status = await getFileStatus(fileId);

    if (!status) {
      // Reconstruct status from job data - we have everything we need
      // This handles cases where Redis TTL expired but the job is still valid
      logger.warn(
        { fileId, jobId: job.id },
        "file_status_not_in_redis_using_job_data",
      );

      status = {
        fileId,
        userId,
        conversationId,
        conversationStateId,
        s3Key,
        filename,
        contentType,
        size,
        status: "processing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      };
    }

    // Process the file
    const result = await processFile(status);

    // Publish success notification
    await publishNotification({
      type: "file:ready",
      jobId: job.id || fileId,
      conversationId,
      fileId,
      description: result.description,
    });

    logger.info(
      { jobId: job.id, fileId, filename, description: result.description },
      "file_process_job_completed",
    );

    return {
      fileId,
      description: result.description,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logger.error(
      { jobId: job.id, fileId, filename, error: errorMessage },
      "file_process_job_failed",
    );

    // Update status to error
    try {
      const { updateFileStatus } = await import("../../files/status");
      await updateFileStatus(fileId, { status: "error", error: errorMessage });
    } catch (updateError) {
      logger.error({ fileId, updateError }, "failed_to_update_file_status_on_error");
    }

    // Publish error notification
    await publishNotification({
      type: "file:error",
      jobId: job.id || fileId,
      conversationId,
      fileId,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Create and start the file process worker
 */
export function createFileProcessWorker(): Worker<FileProcessJobData, FileProcessJobResult> {
  const connection = getBullMQConnection();

  const worker = new Worker<FileProcessJobData, FileProcessJobResult>(
    "file-process",
    processFileJob,
    {
      connection,
      concurrency: parseInt(process.env.FILE_PROCESS_CONCURRENCY || "5", 10),
      // Lock duration for job processing (2 minutes)
      lockDuration: 120000,
    },
  );

  // Event handlers
  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, fileId: result.fileId },
      "file_process_worker_job_completed",
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, error: error.message },
      "file_process_worker_job_failed",
    );
  });

  worker.on("error", (error) => {
    logger.error({ error: error.message }, "file_process_worker_error");
  });

  logger.info(
    { concurrency: process.env.FILE_PROCESS_CONCURRENCY || "5" },
    "file_process_worker_started",
  );

  return worker;
}
