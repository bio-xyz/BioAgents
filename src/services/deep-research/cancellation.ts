import type { ConversationStateValues, PlanTask } from "../../types/core";

export class DeepResearchCancelledError extends Error {
  constructor(message = "Deep research cancellation requested") {
    super(message);
    this.name = "DeepResearchCancelledError";
  }
}

export function markDeepResearchCancelledValues(
  values: Partial<ConversationStateValues>,
  now: Date = new Date()
): Partial<ConversationStateValues> {
  const cancelledAt = now.toISOString();
  const run = values.deepResearchRun;

  return {
    ...values,
    currentActivity: undefined,
    deepResearchRun: run
      ? {
          ...run,
          cancelRequestedAt: cancelledAt,
          endedAt: cancelledAt,
          expiresAt: cancelledAt,
          isRunning: false,
          lastHeartbeatAt: cancelledAt,
          lastResult: "cancelled",
        }
      : run,
    status: "cancelled",
  };
}

export function isDeepResearchCancellationRequested(
  values: Partial<ConversationStateValues> | null | undefined,
  expected?: {
    rootMessageId?: string;
    stateId?: string;
  }
): boolean {
  if (!values) return false;
  const run = values.deepResearchRun;

  if (run && expected?.rootMessageId && run.rootMessageId !== expected.rootMessageId) {
    return false;
  }
  if (run && expected?.stateId && run.stateId !== expected.stateId) {
    return false;
  }

  return (
    values.status === "cancelled" ||
    run?.lastResult === "cancelled" ||
    typeof run?.cancelRequestedAt === "string"
  );
}

function isSameDeepResearchRun(
  next: Partial<ConversationStateValues>,
  current: Partial<ConversationStateValues>
): boolean {
  const nextRun = next.deepResearchRun;
  const currentRun = current.deepResearchRun;

  if (!nextRun || !currentRun) {
    return true;
  }

  if (
    nextRun.rootMessageId &&
    currentRun.rootMessageId &&
    nextRun.rootMessageId !== currentRun.rootMessageId
  ) {
    return false;
  }

  if (nextRun.stateId && currentRun.stateId && nextRun.stateId !== currentRun.stateId) {
    return false;
  }

  return true;
}

export function preserveDeepResearchCancellationForWrite(
  next: Partial<ConversationStateValues>,
  current: Partial<ConversationStateValues> | null | undefined
): Partial<ConversationStateValues> {
  if (!isDeepResearchCancellationRequested(current) || !current) {
    return next;
  }

  if (!isSameDeepResearchRun(next, current)) {
    return next;
  }

  return {
    ...next,
    currentActivity: undefined,
    deepResearchRun: current.deepResearchRun
      ? {
          ...(next.deepResearchRun || {}),
          ...current.deepResearchRun,
          isRunning: false,
          lastResult: "cancelled",
        }
      : next.deepResearchRun,
    status: "cancelled",
  };
}

export function throwIfDeepResearchCancelled(
  values: Partial<ConversationStateValues> | null | undefined,
  expected?: {
    rootMessageId?: string;
    stateId?: string;
  }
): void {
  if (isDeepResearchCancellationRequested(values, expected)) {
    throw new DeepResearchCancelledError();
  }
}

function collectFromTask(task: PlanTask, out: Set<string>) {
  if (typeof task.bioLiteratureJobId === "string" && task.bioLiteratureJobId.trim()) {
    out.add(task.bioLiteratureJobId.trim());
  }

  for (const jobId of task.downstreamJobIds?.bioLiterature || []) {
    if (typeof jobId === "string" && jobId.trim()) {
      out.add(jobId.trim());
    }
  }
}

export function collectBioLiteratureJobIds(
  values: Partial<ConversationStateValues> | null | undefined
): string[] {
  const ids = new Set<string>();
  for (const task of values?.plan || []) {
    collectFromTask(task, ids);
  }
  return [...ids];
}
