/**
 * BullMQ Worker Entry Point
 *
 * This is a separate process that runs the chat and deep-research workers.
 * Start with: bun run worker
 *
 * The worker process connects to Redis and processes jobs from the queues.
 * Multiple worker instances can run in parallel for horizontal scaling.
 */

// Must be first - polyfills for pdf-parse/pdfjs-dist
import "./utils/canvas-polyfill";

import { startChatWorker } from "./services/queue/workers/chat.worker";
import { startDeepResearchWorker } from "./services/queue/workers/deep-research.worker";
import { createFileProcessWorker } from "./services/queue/workers/file-process.worker";
import { startPaperGenerationWorker } from "./services/queue/workers/paper-generation.worker";
import { closeConnections } from "./services/queue/connection";
import logger from "./utils/logger";

async function main() {
  logger.info("Starting BullMQ workers...");

  // Start workers
  const chatWorker = startChatWorker();
  const deepResearchWorker = startDeepResearchWorker();
  const fileProcessWorker = createFileProcessWorker();
  const paperGenerationWorker = startPaperGenerationWorker();

  logger.info(
    {
      chatConcurrency: process.env.CHAT_QUEUE_CONCURRENCY || 5,
      deepResearchConcurrency: process.env.DEEP_RESEARCH_QUEUE_CONCURRENCY || 3,
      fileProcessConcurrency: process.env.FILE_PROCESS_CONCURRENCY || 5,
      paperGenerationConcurrency: process.env.PAPER_GENERATION_CONCURRENCY || 1,
      redisUrl: process.env.REDIS_URL ? "[REDACTED]" : "redis://localhost:6379",
    },
    "workers_started",
  );

  // Graceful shutdown handler
  // Workers will finish their current jobs before stopping
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown_signal_received_waiting_for_jobs_to_finish");

    // Close workers - this waits for current jobs to complete
    const closePromises = [
      chatWorker.close().then(() => logger.info("chat_worker_closed")),
      deepResearchWorker.close().then(() => logger.info("deep_research_worker_closed")),
      fileProcessWorker.close().then(() => logger.info("file_process_worker_closed")),
      paperGenerationWorker.close().then(() => logger.info("paper_generation_worker_closed")),
    ];

    logger.info("waiting_for_all_workers_to_finish_current_jobs");
    await Promise.all(closePromises);

    logger.info("all_workers_closed_cleaning_up_connections");
    await closeConnections();

    logger.info("graceful_shutdown_complete");
    process.exit(0);
  };

  // Handle shutdown signals
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    logger.error({ error }, "uncaught_exception_in_worker");
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "unhandled_rejection_in_worker");
    // Don't exit on unhandled rejection, just log it
  });
}

// Run the worker
main().catch((error) => {
  logger.error({ error }, "worker_startup_failed");
  process.exit(1);
});
