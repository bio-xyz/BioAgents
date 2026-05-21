import { afterEach, describe, expect, mock, test } from "bun:test";
import type {
  PaperLifecycleErrorEvent,
  PaperLifecycleProgressEvent,
  PaperLifecycleSuccessEvent,
} from "../lifecycle";

interface PaperUpdate {
  status?: string;
  pdf_path?: string;
  error?: string;
  progress?: { percent: number; stage: string };
}

function makeFakeSupabase() {
  const updates: PaperUpdate[] = [];
  const update = (patch: PaperUpdate) => {
    updates.push(patch);
    return { eq: (_col: string, _val: unknown) => Promise.resolve({ data: null, error: null }) };
  };
  const from = (_table: string) => ({ update });
  return { client: { from }, updates };
}

afterEach(() => {
  mock.restore();
});

describe("runPaperGenerationLifecycle", () => {
  test("transitions pending -> processing -> completed; fires onProgress and onSuccess", async () => {
    const fake = makeFakeSupabase();
    mock.module("../../../db/client", () => ({
      getServiceClient: () => fake.client,
    }));
    mock.module("../generatePaper", () => ({
      generatePaperFromConversation: async (
        _conversationId: string,
        _userId: string,
        _paperId: string,
        onProgress?: (stage: string) => Promise<void>
      ) => {
        await onProgress?.("validating");
        await onProgress?.("metadata");
        return { pdfPath: "user/u/paper.pdf", pdfUrl: "https://x", rawLatexUrl: "https://y" };
      },
    }));

    const { runPaperGenerationLifecycle } = await import("../lifecycle");

    const progress: PaperLifecycleProgressEvent[] = [];
    const successes: PaperLifecycleSuccessEvent[] = [];
    const result = await runPaperGenerationLifecycle(
      { conversationId: "c-1", paperId: "p-1", userId: "u-1" },
      {
        onProgress: async (e) => {
          progress.push(e);
        },
        onSuccess: async (e) => {
          successes.push(e);
        },
      }
    );

    // First update: status -> processing
    expect(fake.updates[0]).toEqual({ status: "processing" });
    // Progress updates write percent + stage
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({ paperId: "p-1", percent: 5, stage: "validating" });
    expect(progress[1]).toMatchObject({ paperId: "p-1", percent: 20, stage: "metadata" });
    // Final update: completed + pdf_path
    const finalUpdate = fake.updates.find((u) => u.status === "completed");
    expect(finalUpdate).toMatchObject({
      pdf_path: "user/u/paper.pdf",
      progress: { percent: 100, stage: "cleanup" },
      status: "completed",
    });
    expect(successes).toHaveLength(1);
    expect(result.pdfPath).toBe("user/u/paper.pdf");
    expect(result.paperId).toBe("p-1");
  });

  test("on failure: writes status='failed' with error, fires onError, rethrows", async () => {
    const fake = makeFakeSupabase();
    mock.module("../../../db/client", () => ({
      getServiceClient: () => fake.client,
    }));
    const failure = new Error("LaTeX compilation failed");
    mock.module("../generatePaper", () => ({
      generatePaperFromConversation: async () => {
        throw failure;
      },
    }));

    const { runPaperGenerationLifecycle } = await import("../lifecycle");

    const errors: PaperLifecycleErrorEvent[] = [];
    await expect(
      runPaperGenerationLifecycle(
        { conversationId: "c-2", paperId: "p-2", userId: "u-2" },
        {
          onError: async (e) => {
            errors.push(e);
          },
        }
      )
    ).rejects.toBe(failure);

    expect(fake.updates[0]).toEqual({ status: "processing" });
    const failedUpdate = fake.updates.find((u) => u.status === "failed");
    expect(failedUpdate).toMatchObject({
      error: "LaTeX compilation failed",
      status: "failed",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      conversationId: "c-2",
      errorMessage: "LaTeX compilation failed",
      paperId: "p-2",
    });
  });

  test("normalises non-Error throws to String(err) in onError", async () => {
    const fake = makeFakeSupabase();
    mock.module("../../../db/client", () => ({
      getServiceClient: () => fake.client,
    }));
    mock.module("../generatePaper", () => ({
      generatePaperFromConversation: async () => {
        throw "out of memory";
      },
    }));
    const { runPaperGenerationLifecycle } = await import("../lifecycle");

    const errors: PaperLifecycleErrorEvent[] = [];
    await expect(
      runPaperGenerationLifecycle(
        { conversationId: "c", paperId: "p", userId: "u" },
        {
          onError: async (e) => {
            errors.push(e);
          },
        }
      )
    ).rejects.toBe("out of memory");

    expect(errors[0]!.errorMessage).toBe("out of memory");
  });

  test("works without hooks", async () => {
    const fake = makeFakeSupabase();
    mock.module("../../../db/client", () => ({
      getServiceClient: () => fake.client,
    }));
    mock.module("../generatePaper", () => ({
      generatePaperFromConversation: async () => ({ pdfPath: "x" }),
    }));
    const { runPaperGenerationLifecycle } = await import("../lifecycle");

    const result = await runPaperGenerationLifecycle({
      conversationId: "c",
      paperId: "p",
      userId: "u",
    });
    expect(result.pdfPath).toBe("x");
  });

  test("onSuccess hook failure does not mask the result", async () => {
    const fake = makeFakeSupabase();
    mock.module("../../../db/client", () => ({
      getServiceClient: () => fake.client,
    }));
    mock.module("../generatePaper", () => ({
      generatePaperFromConversation: async () => ({ pdfPath: "x" }),
    }));
    const { runPaperGenerationLifecycle } = await import("../lifecycle");

    const result = await runPaperGenerationLifecycle(
      { conversationId: "c", paperId: "p", userId: "u" },
      {
        onSuccess: async () => {
          throw new Error("notify failed");
        },
      }
    );
    expect(result.pdfPath).toBe("x");
  });
});
