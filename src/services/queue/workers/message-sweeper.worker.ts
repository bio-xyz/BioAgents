/**
 * Message Sweeper Worker
 *
 * Periodic background job that flips stale PENDING message rows to FAILED
 * after a backend crash. Streaming chat bypasses BullMQ retries, so without
 * this sweeper a process death mid-stream leaves the row PENDING forever.
 */

import { type Job, Worker } from "bullmq";
import logger from "../../../utils/logger";
import { getBullMQConnection, isJobQueueEnabled } from "../connection";
import type { MessageSweepJobData, MessageSweepJobResult } from "../types";

// BullMQ job states that indicate the worker hasn't picked up (or is still
// running) the job. A row whose chat job is in any of these states is NOT
// an orphan; the sweeper must leave it alone, otherwise the worker will
// later overwrite the FAILED row with COMPLETE and silently violate the
// terminal-state contract.
const ALIVE_BULLMQ_STATES = new Set(["waiting", "delayed", "active", "paused"]);

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

  let chatOrphanIds = (candidates ?? [])
    .filter((row) => {
      const state = row.state as { values?: { isDeepResearch?: boolean } } | null;
      return state?.values?.isDeepResearch !== true;
    })
    .map((row) => row.id as string);

  // In queue mode, additionally skip rows whose chat BullMQ job is still
  // alive (waiting / delayed / active / paused). The job hasn't been picked
  // up by a worker yet — this is a slow worker or an offline worker, not a
  // dead orphan. Flipping the row here would let the worker later overwrite
  // FAILED with COMPLETE, breaking the terminal-state guarantee.
  //
  // Also check for the chat-retry-in-progress marker. The retry endpoint
  // sets that marker between the PENDING reset and `job.retry()`, a window
  // where BullMQ state is still `failed` (not in the alive set) but flipping
  // the row would defeat the in-flight retry. The marker closes that race.
  if (isJobQueueEnabled() && chatOrphanIds.length > 0) {
    try {
      const { getChatQueue } = await import("../queues");
      const { getBullMQConnection } = await import("../connection");
      const { chatRetryMarkerKey } = await import("../retry-marker");
      const chatQueue = getChatQueue();
      const redis = getBullMQConnection();

      // Batch the marker existence check into one Redis round-trip via
      // pipelining. With N candidates this collapses N EXISTS calls into
      // one network hop; in steady state most calls return 0 anyway.
      const markerKeys = chatOrphanIds.map((id) => chatRetryMarkerKey(id));
      let markerByIndex = new Array<boolean>(chatOrphanIds.length).fill(false);
      try {
        const pipeline = redis.pipeline();
        for (const key of markerKeys) pipeline.exists(key);
        const results = await pipeline.exec();
        if (results) {
          markerByIndex = results.map(([_err, value]) => Number(value) > 0);
        }
      } catch (markerErr) {
        logger.warn({ err: markerErr }, "message_sweeper_retry_marker_pipeline_failed");
        // Treat all as alive on pipeline failure — safer than flipping rows
        // we couldn't verify against the marker.
        markerByIndex = markerByIndex.map(() => true);
      }

      // BullMQ state checks for the remaining candidates run in parallel.
      // Per-candidate failure falls open (treat as alive) — safer than
      // flipping a live row to FAILED.
      const stateChecks = chatOrphanIds.map(async (id, i) => {
        if (markerByIndex[i]) return { alive: true, id };
        try {
          const queueJob = await chatQueue.getJob(id);
          if (!queueJob) return { alive: false, id };
          const state = await queueJob.getState();
          return { alive: ALIVE_BULLMQ_STATES.has(state), id };
        } catch (jobErr) {
          logger.warn({ err: jobErr, messageId: id }, "message_sweeper_job_state_check_failed");
          return { alive: true, id };
        }
      });
      const results = await Promise.all(stateChecks);
      const liveJobIds = new Set(results.filter((r) => r.alive).map((r) => r.id));

      if (liveJobIds.size > 0) {
        logger.info(
          { skippedCount: liveJobIds.size, totalCandidates: chatOrphanIds.length },
          "message_sweeper_skipped_live_jobs"
        );
      }
      chatOrphanIds = chatOrphanIds.filter((id) => !liveJobIds.has(id));
    } catch (queueErr) {
      // If we can't get the queue at all (Redis down, etc.), skip the whole
      // sweep round. Better to leak rows for one interval than to flip live
      // ones with no visibility into worker state.
      logger.error({ err: queueErr, jobId }, "message_sweeper_queue_check_failed_skipping_sweep");
      return { cutoffIso, durationMs: Date.now() - start, flippedCount: 0 };
    }
  }

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
