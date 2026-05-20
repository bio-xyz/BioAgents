/**
 * BullMQ Worker Entry Point
 *
 * This is a separate process that runs the chat and deep-research workers.
 * Start with: bun run worker
 *
 * The worker process connects to Redis and processes jobs from the queues.
 * Multiple worker instances can run in parallel for horizontal scaling.
 *
 * In Kubernetes deployments, each Deployment runs a subset of workers via
 * `ENABLE_*_WORKER` env flags. Defaults are `true` so docker-compose and
 * single-process deployments continue to start every worker.
 */

// Must be first - polyfills for pdf-parse/pdfjs-dist
import "./utils/canvas-polyfill";

import type { Worker } from "bullmq";
import { closeConnections, getBullMQConnection } from "./services/queue/connection";
import { startChatWorker } from "./services/queue/workers/chat.worker";
import { startDeepResearchWorker } from "./services/queue/workers/deep-research.worker";
import { createFileProcessWorker } from "./services/queue/workers/file-process.worker";
import {
  registerMessageSweeperSchedule,
  startMessageSweeperWorker,
} from "./services/queue/workers/message-sweeper.worker";
import { startPaperGenerationWorker } from "./services/queue/workers/paper-generation.worker";
import logger from "./utils/logger";

function isEnabled(envVar: string): boolean {
  return process.env[envVar] !== "false";
}

async function main() {
  logger.info("Starting BullMQ workers...");

  const enabled = {
    chat: isEnabled("ENABLE_CHAT_WORKER"),
    deepResearch: isEnabled("ENABLE_DEEP_RESEARCH_WORKER"),
    fileProcess: isEnabled("ENABLE_FILE_PROCESS_WORKER"),
    messageSweeper: isEnabled("ENABLE_MESSAGE_SWEEPER_WORKER"),
    paperGeneration: isEnabled("ENABLE_PAPER_GENERATION_WORKER"),
  };

  const workers: { name: string; worker: Worker }[] = [];
  if (enabled.chat) workers.push({ name: "chat", worker: startChatWorker() });
  if (enabled.deepResearch)
    workers.push({ name: "deep_research", worker: startDeepResearchWorker() });
  if (enabled.fileProcess)
    workers.push({ name: "file_process", worker: createFileProcessWorker() });
  if (enabled.paperGeneration)
    workers.push({ name: "paper_generation", worker: startPaperGenerationWorker() });
  if (enabled.messageSweeper) {
    workers.push({ name: "message_sweeper", worker: startMessageSweeperWorker() });
    await registerMessageSweeperSchedule();
  }

  if (workers.length === 0) {
    logger.error("no_workers_enabled_check_ENABLE_envvars");
    process.exit(1);
  }

  logger.info(
    {
      chatConcurrency: process.env.CHAT_QUEUE_CONCURRENCY || 5,
      deepResearchConcurrency: process.env.DEEP_RESEARCH_QUEUE_CONCURRENCY || 3,
      enabled,
      fileProcessConcurrency: process.env.FILE_PROCESS_CONCURRENCY || 5,
      paperGenerationConcurrency: process.env.PAPER_GENERATION_CONCURRENCY || 1,
      redisUrl: process.env.REDIS_URL ? "[REDACTED]" : "redis://localhost:6379",
    },
    "workers_started"
  );

  // Health server for Kubernetes liveness/readiness probes.
  // `getBullMQConnection` returns the singleton already created by the workers above.
  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 9000);
  const redis = getBullMQConnection();
  const healthServer = Bun.serve({
    fetch(req) {
      const { pathname } = new URL(req.url);
      const allRunning = workers.every(({ worker }) => worker.isRunning());
      const redisStatus = redis.status;
      const body = { redisStatus, workers: workers.map((w) => w.name) };

      if (pathname === "/health/ready") {
        const ok = allRunning && redisStatus === "ready";
        return Response.json({ ok, ...body }, { status: ok ? 200 : 503 });
      }
      if (pathname === "/health/live") {
        // Lenient: tolerate transient reconnects so a Redis blip doesn't trigger
        // a pod restart that kills in-flight jobs.
        const ok =
          allRunning &&
          (redisStatus === "ready" ||
            redisStatus === "connecting" ||
            redisStatus === "reconnecting");
        return Response.json({ ok, ...body }, { status: ok ? 200 : 503 });
      }
      return new Response("not found", { status: 404 });
    },
    port: healthPort,
  });
  logger.info({ port: healthPort }, "worker_health_server_started");

  // Graceful shutdown handler
  // Workers will finish their current jobs before stopping
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown_signal_received_waiting_for_jobs_to_finish");

    // Stop probes before draining so K8s rolling updates don't see flapping
    // readiness while workers wind down.
    healthServer.stop();

    // Close workers - this waits for current jobs to complete
    const closePromises = workers.map(({ name, worker }) =>
      worker.close().then(() => logger.info(`${name}_worker_closed`))
    );

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
