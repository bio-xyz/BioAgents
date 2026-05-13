import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import logger from "../../../utils/logger";
import type {
  FileLifecycleErrorEvent,
  FileLifecycleHooks,
  FileLifecycleSuccessEvent,
} from "../lifecycle";
import type { FileStatusRecord } from "../status";

const baseStatus: FileStatusRecord = {
  contentType: "text/plain",
  conversationId: "conv-1",
  conversationStateId: "cs-1",
  createdAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-01-01T01:00:00Z",
  fileId: "file-1",
  filename: "notes.txt",
  s3Key: "uploads/notes.txt",
  size: 42,
  status: "uploaded",
  updatedAt: "2026-01-01T00:00:00Z",
  userId: "user-1",
};

afterEach(() => {
  jest.restoreAllMocks();
  mock.restore();
});

describe("runFileProcessingLifecycle", () => {
  test("calls processFile and onSuccess with the description", async () => {
    mock.module("../index", () => ({
      processFile: async () => ({ description: "An interesting file" }),
    }));
    const { runFileProcessingLifecycle } = await import("../lifecycle");

    const events: FileLifecycleSuccessEvent[] = [];
    const errors: FileLifecycleErrorEvent[] = [];
    const hooks: FileLifecycleHooks = {
      onError: async (e) => {
        errors.push(e);
      },
      onSuccess: async (e) => {
        events.push(e);
      },
    };

    const result = await runFileProcessingLifecycle(baseStatus, hooks);

    expect(result).toEqual({ description: "An interesting file" });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      description: "An interesting file",
      status: baseStatus,
    });
    expect(errors).toHaveLength(0);
  });

  test("calls onError and rethrows when processFile throws", async () => {
    const failure = new Error("download failed");
    mock.module("../index", () => ({
      processFile: async () => {
        throw failure;
      },
    }));
    const { runFileProcessingLifecycle } = await import("../lifecycle");

    const events: FileLifecycleSuccessEvent[] = [];
    const errors: FileLifecycleErrorEvent[] = [];
    const hooks: FileLifecycleHooks = {
      onError: async (e) => {
        errors.push(e);
      },
      onSuccess: async (e) => {
        events.push(e);
      },
    };

    await expect(runFileProcessingLifecycle(baseStatus, hooks)).rejects.toBe(failure);

    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      errorMessage: "download failed",
      status: baseStatus,
    });
  });

  test("normalises non-Error throws to 'Unknown error'", async () => {
    mock.module("../index", () => ({
      processFile: async () => {
        throw "string failure";
      },
    }));
    const { runFileProcessingLifecycle } = await import("../lifecycle");

    const errors: FileLifecycleErrorEvent[] = [];
    await expect(
      runFileProcessingLifecycle(baseStatus, {
        onError: async (e) => {
          errors.push(e);
        },
      })
    ).rejects.toBe("string failure");
    expect(errors[0]!.errorMessage).toBe("Unknown error");
  });

  test("works without any hooks (in-process default)", async () => {
    mock.module("../index", () => ({
      processFile: async () => ({ description: "no hooks" }),
    }));
    const { runFileProcessingLifecycle } = await import("../lifecycle");

    await expect(runFileProcessingLifecycle(baseStatus)).resolves.toEqual({
      description: "no hooks",
    });
  });

  test("onSuccess hook failure is logged and result still returned", async () => {
    mock.module("../index", () => ({
      processFile: async () => ({ description: "ok" }),
    }));
    const { runFileProcessingLifecycle } = await import("../lifecycle");

    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const onSuccess = jest.fn(async () => {
      throw new Error("notify failed");
    });

    const result = await runFileProcessingLifecycle(baseStatus, { onSuccess });

    expect(result).toEqual({ description: "ok" });
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some(([, msg]) => msg === "file_lifecycle_on_success_hook_failed")
    ).toBe(true);
  });

  test("onError hook failure does not mask the original processFile error", async () => {
    const original = new Error("processing failed");
    mock.module("../index", () => ({
      processFile: async () => {
        throw original;
      },
    }));
    const { runFileProcessingLifecycle } = await import("../lifecycle");

    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const onError = jest.fn(async () => {
      throw new Error("hook failed");
    });

    await expect(runFileProcessingLifecycle(baseStatus, { onError })).rejects.toBe(original);
    expect(
      warnSpy.mock.calls.some(([, msg]) => msg === "file_lifecycle_on_error_hook_failed")
    ).toBe(true);
  });
});
