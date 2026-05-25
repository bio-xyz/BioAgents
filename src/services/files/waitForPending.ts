import type { Queue } from "bullmq";
import logger from "../../utils/logger";
import type { FileProcessJobData, FileProcessJobResult } from "../queue/types";
import type { FileStatusRecord } from "./status";

export interface WaitForPendingFilesArgs {
  jobId: string | undefined;
  conversationStateId: string;
  pendingFileIds: string[];
  fileProcessQueue: Queue<FileProcessJobData, FileProcessJobResult> | null;
  getFileStatus: (fileId: string) => Promise<FileStatusRecord | null>;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

/**
 * Poll until every pending file reports ready/completed/failed, or until the
 * total wait budget is exhausted. Broken out of chat.worker.ts so it can be
 * unit tested with injected deps — the worker provides the real queue and
 * status reader via dynamic imports.
 */
export async function waitForPendingFiles(args: WaitForPendingFilesArgs): Promise<void> {
  const {
    jobId,
    conversationStateId,
    pendingFileIds,
    fileProcessQueue,
    getFileStatus,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    maxWaitMs = 120_000,
    pollIntervalMs = 500,
  } = args;

  if (pendingFileIds.length === 0) return;

  if (!fileProcessQueue) {
    logger.warn(
      { conversationStateId, jobId, pendingFileIds },
      "chat_worker_file_queue_unavailable_skipping_wait"
    );
    return;
  }

  const startWait = Date.now();

  for (const fileId of pendingFileIds) {
    while (Date.now() - startWait < maxWaitMs) {
      const fileJob = await fileProcessQueue.getJob(fileId);
      const fileJobState = fileJob ? await fileJob.getState() : null;
      const fileStatus = await getFileStatus(fileId);

      if (fileJobState === "completed" || fileStatus?.status === "ready" || !fileJob) {
        logger.info(
          {
            fileId,
            fileJobState,
            fileStatus: fileStatus?.status,
            jobId,
          },
          "chat_job_file_ready"
        );
        break;
      }

      if (fileJobState === "failed" || fileStatus?.status === "error") {
        logger.warn(
          {
            fileId,
            fileJobState,
            fileStatus: fileStatus?.status,
            jobId,
          },
          "chat_job_file_failed_continuing"
        );
        break;
      }

      await sleep(pollIntervalMs);
    }
  }
}
