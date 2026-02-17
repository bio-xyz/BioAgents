import { getConversationState, updateConversationState } from "../../db/operations";
import { getBullMQConnection } from "../queue/connection";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";
import type { ConversationStateValues } from "../../types/core";

const START_MUTEX_TTL_SECONDS = 15;
const START_MUTEX_RETRY_DELAY_MS = 100;
const START_MUTEX_MAX_RETRIES = 20;

const RUN_STALE_MS = 4 * 60 * 60 * 1000; // 4 hours for 1 iteration to become stale

type DeepResearchRun = NonNullable<ConversationStateValues["deepResearchRun"]>;

export type ActiveRunDedupInfo = {
  messageId: string;
  stateId: string;
  mode: "queue" | "in-process";
  jobId?: string;
  startedAt: string;
  lastHeartbeatAt: string;
  expiresAt: string;
};

export type StartMutexLock = {
  key: string;
  token: string;
  acquired: boolean;
  fallback: boolean;
};

export async function acquireStartMutex(
  conversationStateId: string,
): Promise<StartMutexLock> {
  const key = `lock:deep_research:start:${conversationStateId}`;
  const token = generateUUID();

  // In non-queue mode with no Redis config, skip mutex and fall back to best-effort DB checks.
  if (
    process.env.USE_JOB_QUEUE !== "true"
    && !process.env.REDIS_URL
    && !process.env.REDIS_HOST
  ) {
    return { key, token, acquired: false, fallback: true };
  }

  try {
    const redis = getBullMQConnection();

    for (let attempt = 0; attempt <= START_MUTEX_MAX_RETRIES; attempt++) {
      const acquired = await redis.set(
        key,
        token,
        "EX",
        START_MUTEX_TTL_SECONDS,
        "NX",
      );
      if (acquired === "OK") {
        return { key, token, acquired: true, fallback: false };
      }

      if (attempt < START_MUTEX_MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, START_MUTEX_RETRY_DELAY_MS * (attempt + 1)),
        );
      }
    }

    logger.warn(
      { conversationStateId, key, retries: START_MUTEX_MAX_RETRIES },
      "deep_research_start_mutex_not_acquired",
    );

    return { key, token, acquired: false, fallback: false };
  } catch (error) {
    logger.warn(
      { error, conversationStateId },
      "deep_research_start_mutex_unavailable_fallback",
    );
    return { key, token, acquired: false, fallback: true };
  }
}

export async function releaseStartMutex(lock: StartMutexLock): Promise<void> {
  if (!lock.acquired) return;

  try {
    const redis = getBullMQConnection();
    await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      lock.key,
      lock.token,
    );
  } catch (error) {
    logger.warn(
      { error, key: lock.key },
      "deep_research_start_mutex_release_failed",
    );
  }
}

function parseTimestampMs(value?: string): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function getHeartbeatAndExpiry(run: DeepResearchRun): {
  heartbeatMs: number | null;
  expiresMs: number | null;
} {
  const heartbeatMs = parseTimestampMs(run.lastHeartbeatAt);
  const expiresMs = parseTimestampMs(run.expiresAt);
  return { heartbeatMs, expiresMs };
}

export function isStaleRun(
  run?: ConversationStateValues["deepResearchRun"],
  nowMs: number = Date.now(),
): boolean {
  if (!run?.isRunning) return false;

  const { heartbeatMs, expiresMs } = getHeartbeatAndExpiry(run);

  if (expiresMs !== null && nowMs >= expiresMs) {
    return true;
  }

  if (heartbeatMs !== null && nowMs - heartbeatMs > RUN_STALE_MS) {
    return true;
  }

  // Missing heartbeat/expiry for a running run is treated as stale.
  if (heartbeatMs === null && expiresMs === null) {
    return true;
  }

  return false;
}

export function isActiveRun(
  run?: ConversationStateValues["deepResearchRun"],
  nowMs: number = Date.now(),
): run is DeepResearchRun {
  return !!run?.isRunning && !isStaleRun(run, nowMs);
}

export function getActiveRunForDedupFromValues(
  values: any,
  nowMs: number = Date.now(),
): ActiveRunDedupInfo | null {
  const run = values?.deepResearchRun as ConversationStateValues["deepResearchRun"];
  if (!isActiveRun(run, nowMs)) return null;
  if (!run.rootMessageId || !run.stateId || !run.mode) return null;

  return {
    messageId: run.rootMessageId,
    stateId: run.stateId,
    mode: run.mode,
    jobId: run.jobId,
    startedAt: run.startedAt,
    lastHeartbeatAt: run.lastHeartbeatAt,
    expiresAt: run.expiresAt,
  };
}

export async function getActiveRunForDedup(
  conversationStateId: string,
  nowMs: number = Date.now(),
): Promise<ActiveRunDedupInfo | null> {
  const record = await getConversationState(conversationStateId);
  if (!record) return null;
  return getActiveRunForDedupFromValues(record.values || {}, nowMs);
}

function buildRunTimestamps(nowMs: number): {
  nowIso: string;
  expiresIso: string;
} {
  const nowIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + RUN_STALE_MS).toISOString();
  return { nowIso, expiresIso };
}

export async function markRunStarted(params: {
  conversationStateId: string;
  rootMessageId: string;
  stateId: string;
  mode: "queue" | "in-process";
  jobId?: string;
}): Promise<DeepResearchRun> {
  const { conversationStateId, rootMessageId, stateId, mode, jobId } = params;
  const record = await getConversationState(conversationStateId);
  const values = { ...(record?.values || {}) };
  const nowMs = Date.now();
  const { nowIso, expiresIso } = buildRunTimestamps(nowMs);

  const run: DeepResearchRun = {
    isRunning: true,
    rootMessageId,
    stateId,
    mode,
    ...(jobId ? { jobId } : {}),
    startedAt: nowIso,
    lastHeartbeatAt: nowIso,
    expiresAt: expiresIso,
  };

  values.deepResearchRun = run;
  await updateConversationState(conversationStateId, values);
  return run;
}

export async function touchRun(params: {
  conversationStateId: string;
  rootMessageId?: string;
  stateId?: string;
}): Promise<boolean> {
  const { conversationStateId, rootMessageId, stateId } = params;
  const record = await getConversationState(conversationStateId);
  const values = { ...(record?.values || {}) };
  const run = values.deepResearchRun as ConversationStateValues["deepResearchRun"];

  if (!run?.isRunning) return false;
  if (rootMessageId && run.rootMessageId !== rootMessageId) return false;
  if (stateId && run.stateId !== stateId) return false;

  const nowMs = Date.now();
  const { nowIso, expiresIso } = buildRunTimestamps(nowMs);

  values.deepResearchRun = {
    ...run,
    lastHeartbeatAt: nowIso,
    expiresAt: expiresIso,
  };

  await updateConversationState(conversationStateId, values);
  return true;
}

export async function updateRunJobId(params: {
  conversationStateId: string;
  jobId: string;
  rootMessageId?: string;
  stateId?: string;
}): Promise<boolean> {
  const { conversationStateId, jobId, rootMessageId, stateId } = params;
  const record = await getConversationState(conversationStateId);
  const values = { ...(record?.values || {}) };
  const run = values.deepResearchRun as ConversationStateValues["deepResearchRun"];

  if (!run?.isRunning) return false;
  if (rootMessageId && run.rootMessageId !== rootMessageId) return false;
  if (stateId && run.stateId !== stateId) return false;

  const nowMs = Date.now();
  const { nowIso, expiresIso } = buildRunTimestamps(nowMs);

  values.deepResearchRun = {
    ...run,
    jobId,
    lastHeartbeatAt: nowIso,
    expiresAt: expiresIso,
  };

  await updateConversationState(conversationStateId, values);
  return true;
}

export async function markRunFinished(params: {
  conversationStateId: string;
  result: "completed" | "failed" | "stale_recovered";
  error?: string;
  rootMessageId?: string;
  stateId?: string;
}): Promise<boolean> {
  const {
    conversationStateId,
    result,
    error,
    rootMessageId: expectedRootMessageId,
    stateId: expectedStateId,
  } = params;

  const record = await getConversationState(conversationStateId);
  if (!record) return false;

  const values = { ...(record.values || {}) };
  const run = values.deepResearchRun as ConversationStateValues["deepResearchRun"];
  if (!run) return false;

  if (expectedRootMessageId && run.rootMessageId !== expectedRootMessageId) {
    return false;
  }
  if (expectedStateId && run.stateId !== expectedStateId) {
    return false;
  }

  const nowIso = new Date().toISOString();

  values.deepResearchRun = {
    ...run,
    isRunning: false,
    lastResult: result,
    lastError: error || undefined,
    endedAt: nowIso,
    lastHeartbeatAt: nowIso,
    expiresAt: nowIso,
  };

  await updateConversationState(conversationStateId, values);
  return true;
}

export const DEEP_RESEARCH_RUN_STALE_MS = RUN_STALE_MS;
