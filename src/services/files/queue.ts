/**
 * File Processing Queue
 * Enqueues file processing jobs for queue mode
 */

import logger from "../../utils/logger";
import type { FileStatusRecord } from "./status";

export interface FileProcessJobData {
  fileId: string;
  userId: string;
  conversationId: string;
  conversationStateId: string;
  s3Key: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * Enqueue a file processing job
 * @returns Job ID
 */
export async function enqueueFileProcess(
  status: FileStatusRecord,
): Promise<string> {
  const { getFileProcessQueue } = await import("../queue/queues");
  const queue = getFileProcessQueue();

  if (!queue) {
    throw new Error("File process queue not available");
  }

  const jobData: FileProcessJobData = {
    fileId: status.fileId,
    userId: status.userId,
    conversationId: status.conversationId,
    conversationStateId: status.conversationStateId,
    s3Key: status.s3Key,
    filename: status.filename,
    contentType: status.contentType,
    size: status.size,
  };

  const job = await queue.add(`process-${status.fileId}`, jobData, {
    jobId: status.fileId,
  });

  logger.info(
    { fileId: status.fileId, jobId: job.id },
    "file_process_job_added",
  );

  return job.id || status.fileId;
}
