import { describe, expect, test } from "bun:test";
import type { ConversationStateValues } from "../../../types/core";
import {
  collectBioLiteratureJobIds,
  isDeepResearchCancellationRequested,
  markDeepResearchCancelledValues,
  preserveDeepResearchCancellationForWrite,
} from "../cancellation";

describe("deep research cancellation helpers", () => {
  test("markDeepResearchCancelledValues marks the active run terminal", () => {
    const values = {
      currentActivity: {
        label: "Searching literature",
        phase: "literature",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      deepResearchRun: {
        expiresAt: "2026-05-08T04:00:00.000Z",
        isRunning: true,
        lastHeartbeatAt: "2026-05-08T00:00:00.000Z",
        mode: "queue",
        rootMessageId: "msg-1",
        startedAt: "2026-05-08T00:00:00.000Z",
        stateId: "state-1",
      },
      status: "processing",
    } as Partial<ConversationStateValues>;

    const result = markDeepResearchCancelledValues(values, new Date("2026-05-08T01:00:00.000Z"));

    expect(result.status).toBe("cancelled");
    expect(result.currentActivity).toBeUndefined();
    expect(result.deepResearchRun?.isRunning).toBe(false);
    expect(result.deepResearchRun?.lastResult).toBe("cancelled");
    expect(result.deepResearchRun?.cancelRequestedAt).toBe("2026-05-08T01:00:00.000Z");
    expect(result.deepResearchRun?.endedAt).toBe("2026-05-08T01:00:00.000Z");
  });

  test("isDeepResearchCancellationRequested respects root message and state guards", () => {
    const values = markDeepResearchCancelledValues({
      deepResearchRun: {
        expiresAt: "2026-05-08T04:00:00.000Z",
        isRunning: true,
        lastHeartbeatAt: "2026-05-08T00:00:00.000Z",
        mode: "queue",
        rootMessageId: "msg-1",
        startedAt: "2026-05-08T00:00:00.000Z",
        stateId: "state-1",
      },
    } as Partial<ConversationStateValues>);

    expect(
      isDeepResearchCancellationRequested(values, { rootMessageId: "msg-1", stateId: "state-1" })
    ).toBe(true);
    expect(
      isDeepResearchCancellationRequested(values, { rootMessageId: "other", stateId: "state-1" })
    ).toBe(false);
  });

  test("preserveDeepResearchCancellationForWrite keeps cancellation terminal across stale worker writes", () => {
    const current = markDeepResearchCancelledValues(
      {
        currentActivity: {
          label: "Searching literature",
          phase: "literature",
          updatedAt: "2026-05-08T00:00:00.000Z",
        },
        deepResearchRun: {
          expiresAt: "2026-05-08T04:00:00.000Z",
          isRunning: true,
          lastHeartbeatAt: "2026-05-08T00:00:00.000Z",
          mode: "queue",
          rootMessageId: "msg-1",
          startedAt: "2026-05-08T00:00:00.000Z",
          stateId: "state-1",
        },
        status: "processing",
      } as Partial<ConversationStateValues>,
      new Date("2026-05-08T01:00:00.000Z")
    );
    const staleWorkerWrite = {
      currentActivity: {
        label: "Generating response",
        phase: "reply",
        updatedAt: "2026-05-08T01:01:00.000Z",
      },
      deepResearchRun: {
        expiresAt: "2026-05-08T04:00:00.000Z",
        isRunning: true,
        lastHeartbeatAt: "2026-05-08T01:01:00.000Z",
        mode: "queue",
        rootMessageId: "msg-1",
        startedAt: "2026-05-08T00:00:00.000Z",
        stateId: "state-1",
      },
      status: "processing",
    } as Partial<ConversationStateValues>;

    const result = preserveDeepResearchCancellationForWrite(staleWorkerWrite, current);

    expect(result.status).toBe("cancelled");
    expect(result.currentActivity).toBeUndefined();
    expect(result.deepResearchRun?.isRunning).toBe(false);
    expect(result.deepResearchRun?.lastResult).toBe("cancelled");
    expect(result.deepResearchRun?.cancelRequestedAt).toBe("2026-05-08T01:00:00.000Z");
  });

  test("preserveDeepResearchCancellationForWrite does not affect a different run", () => {
    const current = markDeepResearchCancelledValues({
      deepResearchRun: {
        expiresAt: "2026-05-08T04:00:00.000Z",
        isRunning: true,
        lastHeartbeatAt: "2026-05-08T00:00:00.000Z",
        mode: "queue",
        rootMessageId: "msg-1",
        startedAt: "2026-05-08T00:00:00.000Z",
        stateId: "state-1",
      },
    } as Partial<ConversationStateValues>);
    const nextRunWrite = {
      deepResearchRun: {
        expiresAt: "2026-05-08T06:00:00.000Z",
        isRunning: true,
        lastHeartbeatAt: "2026-05-08T02:00:00.000Z",
        mode: "queue",
        rootMessageId: "msg-2",
        startedAt: "2026-05-08T02:00:00.000Z",
        stateId: "state-2",
      },
      status: "processing",
    } as Partial<ConversationStateValues>;

    const result = preserveDeepResearchCancellationForWrite(nextRunWrite, current);

    expect(result.status).toBe("processing");
    expect(result.deepResearchRun?.rootMessageId).toBe("msg-2");
  });

  test("collectBioLiteratureJobIds returns unique persisted BioLiterature job IDs", () => {
    const values = {
      plan: [
        {
          bioLiteratureJobId: "bio-1",
          datasets: [],
          objective: "task 1",
          type: "LITERATURE",
        },
        {
          bioLiteratureJobId: "bio-1",
          datasets: [],
          objective: "duplicate",
          type: "LITERATURE",
        },
        {
          datasets: [],
          downstreamJobIds: { bioLiterature: ["bio-2"] },
          objective: "task 2",
          type: "LITERATURE",
        },
      ],
    } as Partial<ConversationStateValues>;

    expect(collectBioLiteratureJobIds(values)).toEqual(["bio-1", "bio-2"]);
  });
});
