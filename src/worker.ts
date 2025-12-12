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

import { startChatWorker } from "./queue/workers/chat.worker";
import { startDeepResearchWorker } from "./queue/workers/deep-research.worker";
import { closeConnections } from "./queue/connection";
import logger from "./utils/logger";

async function main() {
  logger.info("Starting BullMQ workers...");

  // Start workers
  const chatWorker = startChatWorker();
  const deepResearchWorker = startDeepResearchWorker();

  logger.info(
    {
      chatConcurrency: process.env.CHAT_QUEUE_CONCURRENCY || 5,
      deepResearchConcurrency: process.env.DEEP_RESEARCH_QUEUE_CONCURRENCY || 3,
      redisUrl: process.env.REDIS_URL ? "[REDACTED]" : "redis://localhost:6379",
    },
    "workers_started",
  );

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown_signal_received");

    logger.info("Closing chat worker...");
    await chatWorker.close();

    logger.info("Closing deep research worker...");
    await deepResearchWorker.close();

    logger.info("Closing Redis connections...");
    await closeConnections();

    logger.info("Workers shut down gracefully");
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
