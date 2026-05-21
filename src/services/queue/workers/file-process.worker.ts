/**
 * File Process Worker
 * Thin BullMQ adapter around runFileProcessingLifecycle. Reconstructs file
 * status from job data when Redis TTL has expired, then delegates execution
 * + side-effects to the shared lifecycle helper.
 */

import { Job, Worker } from "bullmq";
import logger from "../../../utils/logger";
import { getBullMQConnection } from "../connection";
import { publishNotification } from "../notify";
import type { FileProcessJobData, FileProcessJobResult } from "../types";

async function processFileJob(
  job: Job<FileProcessJobData, FileProcessJobResult>
): Promise<FileProcessJobResult> {
  const {
    fileId,
    filename,
    conversationId,
    userId,
    conversationStateId,
    s3Key,
    contentType,
    size,
  } = job.data;

  logger.info({ fileId, filename, jobId: job.id }, "file_process_job_started");

  const { getFileStatus, updateFileStatus } = await import("../../files/status");
  const { runFileProcessingLifecycle } = await import("../../files/lifecycle");

  // Status may be missing if its Redis TTL elapsed during a long retry delay
  // or after a worker redeploy. Reconstruct from job data — the queue payload
  // already carries everything processFile needs.
  let status = await getFileStatus(fileId);
  if (!status) {
    logger.warn({ fileId, jobId: job.id }, "file_status_not_in_redis_using_job_data");
    status = {
      contentType,
      conversationId,
      conversationStateId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      fileId,
      filename,
      s3Key,
      size,
      status: "processing",
      updatedAt: new Date().toISOString(),
      userId,
    };
  }

  const result = await runFileProcessingLifecycle(status, {
    onError: async ({ errorMessage }) => {
      logger.error(
        { error: errorMessage, fileId, filename, jobId: job.id },
        "file_process_job_failed"
      );
      try {
        await updateFileStatus(fileId, { error: errorMessage, status: "error" });
      } catch (updateError) {
        logger.error({ fileId, updateError }, "failed_to_update_file_status_on_error");
      }
      try {
        await publishNotification({
          conversationId,
          error: errorMessage,
          fileId,
          jobId: job.id || fileId,
          type: "file:error",
        });
      } catch (notifyErr) {
        logger.error({ fileId, notifyErr }, "failed_to_publish_file_error_notification");
      }
    },
    onSuccess: async ({ description }) => {
      await publishNotification({
        conversationId,
        description,
        fileId,
        jobId: job.id || fileId,
        type: "file:ready",
      });
      logger.info({ description, fileId, filename, jobId: job.id }, "file_process_job_completed");
    },
  });

  return {
    description: result.description,
    fileId,
  };
}

export function createFileProcessWorker(): Worker<FileProcessJobData, FileProcessJobResult> {
  const connection = getBullMQConnection();

  const worker = new Worker<FileProcessJobData, FileProcessJobResult>(
    "file-process",
    processFileJob,
    {
      concurrency: parseInt(process.env.FILE_PROCESS_CONCURRENCY || "5", 10),
      connection,
      lockDuration: 120000,
    }
  );

  worker.on("completed", (job, result) => {
    logger.info({ fileId: result.fileId, jobId: job.id }, "file_process_worker_job_completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ error: error.message, jobId: job?.id }, "file_process_worker_job_failed");
  });

  worker.on("error", (error) => {
    logger.error({ error: error.message }, "file_process_worker_error");
  });

  logger.info(
    { concurrency: process.env.FILE_PROCESS_CONCURRENCY || "5" },
    "file_process_worker_started"
  );

  return worker;
}
