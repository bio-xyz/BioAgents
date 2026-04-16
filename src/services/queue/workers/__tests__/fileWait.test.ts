import { afterEach, describe, expect, jest, test } from "bun:test";
import logger from "../../../../utils/logger";
import { waitForPendingFiles } from "../fileWait";

afterEach(() => {
  jest.restoreAllMocks();
});

type FakeFileJob = { getState: () => Promise<string> };

function makeQueue(jobsByFileId: Record<string, FakeFileJob | null>) {
  return {
    getJob: jest.fn((fileId: string) => Promise.resolve(jobsByFileId[fileId] ?? null)),
  } as unknown as Parameters<typeof waitForPendingFiles>[0]["fileProcessQueue"];
}

describe("waitForPendingFiles", () => {
  test("returns immediately when pendingFileIds is empty", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const getFileStatus = jest.fn();
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: null,
      getFileStatus,
      jobId: "j-1",
      pendingFileIds: [],
    });
    expect(getFileStatus).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("warns and returns when queue is null but files are pending (regression fix)", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const getFileStatus = jest.fn();
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: null,
      getFileStatus,
      jobId: "j-1",
      pendingFileIds: ["f-1", "f-2"],
    });
    expect(getFileStatus).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [ctx, msg] = warnSpy.mock.calls[0] as [
      { jobId: string; conversationStateId: string; pendingFileIds: string[] },
      string,
    ];
    expect(msg).toBe("chat_worker_file_queue_unavailable_skipping_wait");
    expect(ctx.jobId).toBe("j-1");
    expect(ctx.pendingFileIds).toEqual(["f-1", "f-2"]);
  });

  test("treats fileJobState=completed as ready and logs info", async () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const queue = makeQueue({
      "f-1": { getState: async () => "completed" },
    });
    const getFileStatus = jest.fn().mockResolvedValue(null);
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: queue,
      getFileStatus,
      jobId: "j-1",
      pendingFileIds: ["f-1"],
      pollIntervalMs: 1,
      sleep: async () => undefined,
    });
    const readyCall = infoSpy.mock.calls.find(([, msg]) => msg === "chat_job_file_ready");
    expect(readyCall).toBeDefined();
  });

  test("treats missing file job as already-cleaned-up (ready)", async () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const queue = makeQueue({ "f-1": null });
    const getFileStatus = jest.fn().mockResolvedValue(null);
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: queue,
      getFileStatus,
      jobId: "j-1",
      pendingFileIds: ["f-1"],
      sleep: async () => undefined,
    });
    const readyCall = infoSpy.mock.calls.find(([, msg]) => msg === "chat_job_file_ready");
    expect(readyCall).toBeDefined();
  });

  test("treats fileStatus.status=ready as ready even if job state is not completed", async () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const queue = makeQueue({
      "f-1": { getState: async () => "active" },
    });
    const getFileStatus = jest.fn().mockResolvedValue({ status: "ready" });
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: queue,
      getFileStatus,
      jobId: "j-1",
      pendingFileIds: ["f-1"],
      sleep: async () => undefined,
    });
    const readyCall = infoSpy.mock.calls.find(([, msg]) => msg === "chat_job_file_ready");
    expect(readyCall).toBeDefined();
  });

  test("warns chat_job_file_failed_continuing on failed state", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const queue = makeQueue({
      "f-1": { getState: async () => "failed" },
    });
    const getFileStatus = jest.fn().mockResolvedValue(null);
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: queue,
      getFileStatus,
      jobId: "j-1",
      pendingFileIds: ["f-1"],
      sleep: async () => undefined,
    });
    const failedCall = warnSpy.mock.calls.find(
      ([, msg]) => msg === "chat_job_file_failed_continuing"
    );
    expect(failedCall).toBeDefined();
  });

  test("warns failed_continuing when fileStatus reports error", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const queue = makeQueue({
      "f-1": { getState: async () => "active" },
    });
    const getFileStatus = jest.fn().mockResolvedValue({ status: "error" });
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: queue,
      getFileStatus,
      jobId: "j-1",
      pendingFileIds: ["f-1"],
      sleep: async () => undefined,
    });
    expect(warnSpy.mock.calls.some(([, msg]) => msg === "chat_job_file_failed_continuing")).toBe(
      true
    );
  });

  test("processes multiple pending file ids sequentially", async () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const queue = makeQueue({
      "f-1": { getState: async () => "completed" },
      "f-2": { getState: async () => "completed" },
    });
    const getFileStatus = jest.fn().mockResolvedValue(null);
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: queue,
      getFileStatus,
      jobId: "j-1",
      pendingFileIds: ["f-1", "f-2"],
      sleep: async () => undefined,
    });
    const readyCalls = infoSpy.mock.calls.filter(([, msg]) => msg === "chat_job_file_ready");
    expect(readyCalls).toHaveLength(2);
  });

  test("respects maxWaitMs and does not loop forever when file never completes", async () => {
    // Use a vanishing budget so the outer while condition is false on first iter.
    const queue = makeQueue({
      "f-1": { getState: async () => "active" },
    });
    const getFileStatus = jest.fn().mockResolvedValue({ status: "processing" });
    // Hardest-to-test path; assert it returns cleanly within a bounded time.
    const before = Date.now();
    await waitForPendingFiles({
      conversationStateId: "cs-1",
      fileProcessQueue: queue,
      getFileStatus,
      jobId: "j-1",
      maxWaitMs: 0,
      pendingFileIds: ["f-1"],
      pollIntervalMs: 1,
      sleep: async () => undefined,
    });
    expect(Date.now() - before).toBeLessThan(1000);
  });
});
