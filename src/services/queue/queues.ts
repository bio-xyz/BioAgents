/**
 * BullMQ Queue Definitions
 *
 * Defines chat and deep-research queues with retry configuration.
 * These queues are only initialized when USE_JOB_QUEUE=true.
 */

import { Queue } from "bullmq";
import { getBullMQConnection, isJobQueueEnabled } from "./connection";
import type {
  ChatJobData,
  ChatJobResult,
  DeepResearchJobData,
  DeepResearchJobResult,
  FileProcessJobData,
  FileProcessJobResult,
  PaperGenerationJobData,
  PaperGenerationJobResult,
} from "./types";
import logger from "../../utils/logger";

// Queue instances (lazy initialized)
let chatQueueInstance: Queue<ChatJobData, ChatJobResult> | null = null;
let deepResearchQueueInstance: Queue<DeepResearchJobData, DeepResearchJobResult> | null = null;
let fileProcessQueueInstance: Queue<FileProcessJobData, FileProcessJobResult> | null = null;
let paperGenerationQueueInstance: Queue<PaperGenerationJobData, PaperGenerationJobResult> | null = null;

/**
 * Get or create the chat queue
 * Chat jobs typically complete in 1-2 minutes
 *
 * Retry config:
 * - 3 attempts with exponential backoff (1s → 2s → 4s)
 * - 3 minute timeout (hard limit)
 */
export function getChatQueue(): Queue<ChatJobData, ChatJobResult> {
  if (!isJobQueueEnabled()) {
    throw new Error("Job queue is not enabled. Set USE_JOB_QUEUE=true to use queues.");
  }

  if (!chatQueueInstance) {
    chatQueueInstance = new Queue<ChatJobData, ChatJobResult>("chat", {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        // Retry configuration
        attempts: 3, // Retry up to 3 times on failure
        backoff: {
          type: "exponential", // 1s, 2s, 4s delays
          delay: 1000,
        },
        // Timeout - chat should complete within 3 minutes
        // timeout: 180000, // 3 minutes hard limit - DISABLED for now, using worker lockDuration instead
        // Job cleanup
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000,
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
        },
      },
    });

    logger.info({ queue: "chat" }, "chat_queue_initialized");
  }

  return chatQueueInstance;
}

/**
 * Get or create the deep research queue
 * Deep research jobs can take 20-30+ minutes
 *
 * Retry config:
 * - 2 attempts with exponential backoff (5s → 10s)
 * - No timeout (let it run as long as needed)
 */
export function getDeepResearchQueue(): Queue<DeepResearchJobData, DeepResearchJobResult> {
  if (!isJobQueueEnabled()) {
    throw new Error("Job queue is not enabled. Set USE_JOB_QUEUE=true to use queues.");
  }

  if (!deepResearchQueueInstance) {
    deepResearchQueueInstance = new Queue<DeepResearchJobData, DeepResearchJobResult>("deep-research", {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        // Retry configuration (fewer retries for long jobs)
        attempts: 2, // Retry up to 2 times
        backoff: {
          type: "exponential", // 5s, 10s delays
          delay: 5000,
        },
        // NO TIMEOUT - deep research can take 20-30+ minutes
        // timeout: undefined,
        // Job cleanup
        removeOnComplete: {
          age: 86400, // Keep for 24 hours
          count: 500,
        },
        removeOnFail: {
          age: 604800, // Keep failed for 7 days
        },
      },
    });

    logger.info({ queue: "deep-research" }, "deep_research_queue_initialized");
  }

  return deepResearchQueueInstance;
}

/**
 * Get or create the file process queue
 * File processing jobs typically complete in 10-60 seconds
 *
 * Retry config:
 * - 3 attempts with exponential backoff (1s → 2s → 4s)
 * - 2 minute timeout
 */
export function getFileProcessQueue(): Queue<FileProcessJobData, FileProcessJobResult> | null {
  if (!isJobQueueEnabled()) {
    return null;
  }

  if (!fileProcessQueueInstance) {
    fileProcessQueueInstance = new Queue<FileProcessJobData, FileProcessJobResult>("file-process", {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: {
          age: 3600, // Keep for 1 hour
          count: 500,
        },
        removeOnFail: {
          age: 86400, // Keep failed for 24 hours
        },
      },
    });

    logger.info({ queue: "file-process" }, "file_process_queue_initialized");
  }

  return fileProcessQueueInstance;
}

/**
 * Get or create the paper generation queue
 * Paper generation can take 5-15+ minutes depending on complexity
 *
 * Config:
 * - NO RETRY: Paper gen has internal fallback strategies for LaTeX compilation
 * - NO TIMEOUT: Allow indefinite execution (like deep research)
 */
export function getPaperGenerationQueue(): Queue<PaperGenerationJobData, PaperGenerationJobResult> {
  if (!isJobQueueEnabled()) {
    throw new Error("Job queue is not enabled. Set USE_JOB_QUEUE=true to use queues.");
  }

  if (!paperGenerationQueueInstance) {
    paperGenerationQueueInstance = new Queue<PaperGenerationJobData, PaperGenerationJobResult>("paper-generation", {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        // NO RETRY - paper gen has internal fallback strategies
        attempts: 1,
        // NO TIMEOUT - let it run as long as needed
        // Job cleanup
        removeOnComplete: {
          age: 86400, // Keep for 24 hours
          count: 500,
        },
        removeOnFail: {
          age: 604800, // Keep failed for 7 days
        },
      },
    });

    logger.info({ queue: "paper-generation" }, "paper_generation_queue_initialized");
  }

  return paperGenerationQueueInstance;
}

/**
 * Close all queue instances (for graceful shutdown)
 */
export async function closeQueues(): Promise<void> {
  const queues = [chatQueueInstance, deepResearchQueueInstance, fileProcessQueueInstance, paperGenerationQueueInstance];

  await Promise.all(
    queues
      .filter((q): q is Queue => q !== null)
      .map((q) => q.close()),
  );

  chatQueueInstance = null;
  deepResearchQueueInstance = null;
  fileProcessQueueInstance = null;
  paperGenerationQueueInstance = null;

  logger.info("queues_closed");
}
