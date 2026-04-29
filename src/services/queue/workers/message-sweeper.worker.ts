/**
 * Message Sweeper Worker
 *
 * Periodic background job that flips stale PENDING message rows to FAILED
 * after a backend crash. Streaming chat bypasses BullMQ retries, so without
 * this sweeper a process death mid-stream leaves the row PENDING forever.
 */

import { type Job, Worker } from "bullmq";
import logger from "../../../utils/logger";
import { getBullMQConnection } from "../connection";
import type { MessageSweepJobData, MessageSweepJobResult } from "../types";

// Sized for chat-mode orphan recovery only. Chat replies finish in 10-30s,
// so any PENDING row past 20min is definitively dead from a process-death
// case (deploy / OOM / segfault) — chat catches mark FAILED immediately on
// recoverable errors, this is the safety net. Deep-research iterations
// (Steering ~20min, Smart ~60min, Autonomous up to ~8h) sit comfortably
// above this threshold; BullMQ retries are the recovery path for those,
// not the sweeper.
const ORPHAN_AGE_MS = 20 * 60 * 1000;
const SWEEPER_INTERVAL_MS = 5 * 60 * 1000;
const SCHEDULER_ID = "message-sweeper";

/**
 * Shared core sweep operation. Used by both the BullMQ worker (queue mode)
 * and the in-process setInterval sweeper (default deployment mode).
 *
 * Two-step to keep the chat-only scope explicit: first SELECT eligible
 * orphan rows joined to their state, then exclude rows whose state has
 * `values.isDeepResearch === true`. Deep-research jobs use BullMQ retries
 * for recovery and routinely sit PENDING for tens of minutes to hours;
 * including them here would clobber legitimate runs.
 *
 * Transitional design — long-term, a dedicated discriminator column on
 * `messages` would make this a single UPDATE without the JOIN.
 */
async function runSweep(jobId?: string | number): Promise<MessageSweepJobResult> {
  const start = Date.now();
  const cutoffIso = new Date(start - ORPHAN_AGE_MS).toISOString();

  const { getServiceClient } = await import("../../../db/client");
  const supabase = getServiceClient();

  const { data: candidates, error: selectError } = await supabase
    .from("messages")
    .select("id, state:states(values)")
    .eq("status", "PENDING")
    .lt("created_at", cutoffIso);

  if (selectError) {
    logger.error({ cutoffIso, error: selectError.message, jobId }, "message_sweeper_query_failed");
    throw selectError;
  }

  const chatOrphanIds = (candidates ?? [])
    .filter((row) => {
      const state = row.state as { values?: { isDeepResearch?: boolean } } | null;
      return state?.values?.isDeepResearch !== true;
    })
    .map((row) => row.id as string);

  let flippedCount = 0;
  if (chatOrphanIds.length > 0) {
    const { data: flipped, error: updateError } = await supabase
      .from("messages")
      .update({ status: "FAILED" })
      .in("id", chatOrphanIds)
      .eq("status", "PENDING")
      .select("id");

    if (updateError) {
      logger.error(
        { cutoffIso, error: updateError.message, jobId },
        "message_sweeper_update_failed"
      );
      throw updateError;
    }
    flippedCount = flipped?.length ?? 0;
  }

  const durationMs = Date.now() - start;

  if (flippedCount > 0) {
    logger.warn({ cutoffIso, durationMs, flippedCount, jobId }, "message_sweeper_flipped_orphans");
  }

  return { cutoffIso, durationMs, flippedCount };
}

async function processSweep(
  job: Job<MessageSweepJobData, MessageSweepJobResult>
): Promise<MessageSweepJobResult> {
  return runSweep(job.id);
}

/**
 * Register the repeatable sweep job. Safe to call multiple times — BullMQ
 * dedupes by scheduler ID.
 */
export async function registerMessageSweeperSchedule(): Promise<void> {
  const { getMessageSweeperQueue } = await import("../queues");
  const queue = getMessageSweeperQueue();
  if (!queue) {
    logger.info("message_sweeper_schedule_skipped_queue_disabled");
    return;
  }

  await queue.upsertJobScheduler(
    SCHEDULER_ID,
    { every: SWEEPER_INTERVAL_MS },
    {
      data: {},
      name: "sweep",
      opts: {
        removeOnComplete: { age: 86400, count: 200 },
        removeOnFail: { age: 604800 },
      },
    }
  );

  logger.info(
    { intervalMs: SWEEPER_INTERVAL_MS, schedulerId: SCHEDULER_ID },
    "message_sweeper_schedule_registered"
  );
}

export function startMessageSweeperWorker(): Worker<MessageSweepJobData, MessageSweepJobResult> {
  const worker = new Worker<MessageSweepJobData, MessageSweepJobResult>(
    "message-sweeper",
    processSweep,
    {
      concurrency: 1,
      connection: getBullMQConnection(),
    }
  );

  worker.on("failed", (job, error) => {
    logger.error({ error: error.message, jobId: job?.id }, "message_sweeper_job_failed");
  });

  logger.info("message_sweeper_worker_started");
  return worker;
}

/**
 * In-process sweeper for deployments running with USE_JOB_QUEUE=false.
 * Uses a plain setInterval on the API server process — no Redis/BullMQ
 * dependency. The chat-agent SSE path is in-process in this mode, so the
 * API server is the natural home for orphan cleanup. Returns the timer so
 * the caller can clear it on graceful shutdown.
 */
export function startInProcessMessageSweeper(): NodeJS.Timeout {
  logger.info(
    { intervalMs: SWEEPER_INTERVAL_MS, orphanAgeMs: ORPHAN_AGE_MS },
    "in_process_message_sweeper_started"
  );
  return setInterval(() => {
    runSweep().catch((err) => {
      logger.error({ err }, "in_process_message_sweeper_failed");
    });
  }, SWEEPER_INTERVAL_MS);
}
