import { describe, expect, test } from "bun:test";
import type { ConversationState, DataArtifact, ProteinStructure } from "../../types/core";
import { buildChatSseStream, type ChatSseStreamDeps } from "../chat-sse-transport";

async function collectEvents(
  stream: ReadableStream
): Promise<Array<{ event: string; data: unknown }>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Array<{ event: string; data: unknown }> = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      const eventLine = block.match(/^event:\s*(\S+)/m);
      const dataLine = block.match(/^data:\s*(.*)/m);
      if (!eventLine || !dataLine) continue;

      try {
        events.push({ data: JSON.parse(dataLine[1]!), event: eventLine[1]! });
      } catch {
        events.push({ data: dataLine[1], event: eventLine[1]! });
      }
    }
  }
  return events;
}

function baseParams(overrides: Partial<Parameters<typeof buildChatSseStream>[0]> = {}) {
  const conversationStateRecord: ConversationState = {
    id: "cs-1",
    values: { objective: "x" } as ConversationState["values"],
  };
  return {
    conversationId: "conv-1",
    conversationStateRecord,
    createdMessage: { id: "msg-1" },
    files: [] as File[],
    markReplyPersisted: () => {},
    message: "hello",
    userId: "user-1",
    ...overrides,
  };
}

const happyDeps = (overrides: ChatSseStreamDeps = {}): ChatSseStreamDeps => ({
  fileUploadAgent: async () => ({}),
  getConversationState: async () => null,
  getFileProcessQueue: () => null,
  getFileStatus: async () => null,
  getPendingFileIds: async () => [],
  markMessageComplete: async () => ({ updated: true }),
  markMessageFailed: async () => undefined,
  notifyChatReplyCompleted: async () => undefined,
  runChatAgent: async () => ({
    hitMaxTokens: false,
    replyText: "Hello world",
    toolCallCount: 0,
    totalInputTokens: 5,
    totalOutputTokens: 2,
  }),
  updateConversationState: async () => undefined,
  waitForPendingFiles: async () => undefined,
  ...overrides,
});

describe("buildChatSseStream", () => {
  test("happy path: emits init -> stream events -> final -> done in order and persists reply", async () => {
    let persistedCalled = false;
    let completedCalls = 0;
    let failedCalls = 0;
    const stream = buildChatSseStream(
      baseParams({ markReplyPersisted: () => (persistedCalled = true) }),
      happyDeps({
        markMessageComplete: async () => {
          completedCalls++;
          return { updated: true };
        },
        markMessageFailed: async () => {
          failedCalls++;
        },
      })
    );

    const events = await collectEvents(stream);
    const order = events.map((e) => e.event);

    expect(order[0]).toBe("init");
    expect(order).toContain("final");
    expect(order.at(-1)).toBe("done");
    expect(completedCalls).toBe(1);
    expect(failedCalls).toBe(0);
    expect(persistedCalled).toBe(true);
  });

  test("truncation: sends error event with reason=truncated, calls markMessageFailed, no final/done", async () => {
    let persistedCalled = false;
    let failedCalls = 0;
    const stream = buildChatSseStream(
      baseParams({ markReplyPersisted: () => (persistedCalled = true) }),
      happyDeps({
        markMessageFailed: async () => {
          failedCalls++;
        },
        runChatAgent: async () => ({ hitMaxTokens: true, replyText: "partial" }),
      })
    );

    const events = await collectEvents(stream);
    const errorEvent = events.find((e) => e.event === "error");

    expect(errorEvent).toBeDefined();
    expect((errorEvent!.data as { reason: string }).reason).toBe("truncated");
    expect(events.map((e) => e.event)).not.toContain("final");
    expect(events.map((e) => e.event)).not.toContain("done");
    expect(failedCalls).toBe(1);
    expect(persistedCalled).toBe(false);
  });

  test("empty reply: sends error event, calls markMessageFailed, no final/done", async () => {
    let failedCalls = 0;
    const stream = buildChatSseStream(
      baseParams(),
      happyDeps({
        markMessageFailed: async () => {
          failedCalls++;
        },
        runChatAgent: async () => ({ replyText: "" }),
      })
    );

    const events = await collectEvents(stream);
    const order = events.map((e) => e.event);

    expect(order).toContain("error");
    expect(order).not.toContain("final");
    expect(failedCalls).toBe(1);
  });

  test("markMessageComplete returns updated:false: error event, NO markMessageFailed", async () => {
    let failedCalls = 0;
    const stream = buildChatSseStream(
      baseParams(),
      happyDeps({
        markMessageComplete: async () => ({ updated: false }),
        markMessageFailed: async () => {
          failedCalls++;
        },
      })
    );

    const events = await collectEvents(stream);
    const order = events.map((e) => e.event);

    expect(order).toContain("error");
    expect(failedCalls).toBe(0); // row already terminal — don't downgrade further
  });

  test("post-persist throw does NOT downgrade reply to FAILED (replyPersisted guard)", async () => {
    let failedCalls = 0;
    let persistedCalled = false;
    const stream = buildChatSseStream(
      baseParams({ markReplyPersisted: () => (persistedCalled = true) }),
      happyDeps({
        markMessageComplete: async () => ({ updated: true }),
        markMessageFailed: async () => {
          failedCalls++;
        },
        // Throws AFTER markMessageComplete succeeded
        notifyChatReplyCompleted: async () => {
          throw new Error("downstream notify failure");
        },
      })
    );

    await collectEvents(stream);

    expect(persistedCalled).toBe(true);
    expect(failedCalls).toBe(0); // critical: reply stays COMPLETE
  });

  test("protein structures are persisted via updateConversationState", async () => {
    const protein: ProteinStructure = {
      averagePlddt: 80,
      bcifUrl: "https://example.com/x.bcif",
      entryId: "AF-X-F1",
      entryUrl: "https://example.com/x",
      title: "X",
    };
    let updateCalls = 0;
    const stream = buildChatSseStream(
      baseParams(),
      happyDeps({
        runChatAgent: async () => ({ proteinStructures: [protein], replyText: "ok" }),
        updateConversationState: async () => {
          updateCalls++;
        },
      })
    );

    await collectEvents(stream);
    expect(updateCalls).toBe(1);
  });

  test("presigned files: waits for pending files, refreshes conversation state", async () => {
    let waitCalled = false;
    let freshFetched = false;
    const stream = buildChatSseStream(
      baseParams(),
      happyDeps({
        getConversationState: async () => {
          freshFetched = true;
          return {
            values: { objective: "x", uploadedDatasets: [] } as ConversationState["values"],
          };
        },
        getPendingFileIds: async () => ["file-1"],
        waitForPendingFiles: async () => {
          waitCalled = true;
        },
      })
    );

    await collectEvents(stream);
    expect(waitCalled).toBe(true);
    expect(freshFetched).toBe(true);
  });

  test("FormData files: calls fileUploadAgent before runChatAgent", async () => {
    let uploadCalledBeforeChat = false;
    let chatCalled = false;
    const stream = buildChatSseStream(
      baseParams({ files: [new File(["x"], "x.txt")] }),
      happyDeps({
        fileUploadAgent: async () => {
          if (!chatCalled) uploadCalledBeforeChat = true;
          return {};
        },
        runChatAgent: async () => {
          chatCalled = true;
          return { replyText: "ok" };
        },
      })
    );

    await collectEvents(stream);
    expect(uploadCalledBeforeChat).toBe(true);
    expect(chatCalled).toBe(true);
  });

  test("segment-anything path emits artifacts only after artifact state persists", async () => {
    const artifact: DataArtifact = {
      id: "artifact-1",
      name: "Annotated image",
      path: "artifacts/msg-1/annotated.png",
      type: "image",
    };
    let updateCalls = 0;
    const stream = buildChatSseStream(
      baseParams({ toolId: "segment-anything" }),
      happyDeps({
        runSegmentAnythingChatTool: async () => ({
          artifacts: [artifact],
          text: "segmented",
        }),
        updateConversationState: async () => {
          updateCalls++;
        },
      })
    );

    const events = await collectEvents(stream);
    const finalEvent = events.find((event) => event.event === "final");

    expect(updateCalls).toBe(1);
    expect(finalEvent).toBeDefined();
    expect((finalEvent!.data as { artifacts?: DataArtifact[] }).artifacts).toEqual([artifact]);
  });

  test("segment-anything artifact persistence failure sends an error instead of final artifacts", async () => {
    let failedCalls = 0;
    const stream = buildChatSseStream(
      baseParams({ toolId: "segment-anything" }),
      happyDeps({
        markMessageFailed: async () => {
          failedCalls++;
        },
        runSegmentAnythingChatTool: async () => ({
          artifacts: [
            {
              id: "artifact-1",
              name: "Annotated image",
              path: "artifacts/msg-1/annotated.png",
              type: "image",
            },
          ],
          text: "segmented",
        }),
        updateConversationState: async () => {
          throw new Error("db unavailable");
        },
      })
    );

    const events = await collectEvents(stream);
    const order = events.map((event) => event.event);

    expect(order).toContain("error");
    expect(order).not.toContain("final");
    expect(failedCalls).toBe(1);
  });

  test("target path emits artifacts only after artifact state persists", async () => {
    const artifact: DataArtifact = {
      description: "Target analysis for GLP1R",
      id: "target-msg-1",
      metadata: { _query: "GLP1R", _version: 1 },
      name: "Target: GLP1R",
      type: "target-result",
    };
    let updateCalls = 0;
    const stream = buildChatSseStream(
      baseParams({ toolId: "target", toolInput: { query: "GLP1R" } }),
      happyDeps({
        runTargetChatTool: async () => ({
          artifacts: [artifact],
          text: "Target analysis complete for P43220.",
        }),
        updateConversationState: async () => {
          updateCalls++;
        },
      })
    );

    const events = await collectEvents(stream);
    const finalEvent = events.find((event) => event.event === "final");

    expect(updateCalls).toBe(1);
    expect(finalEvent).toBeDefined();
    expect((finalEvent!.data as { artifacts?: DataArtifact[] }).artifacts).toEqual([artifact]);
  });

  test("target persistence failure sends an error instead of final artifacts", async () => {
    let failedCalls = 0;
    const stream = buildChatSseStream(
      baseParams({ toolId: "target", toolInput: { query: "GLP1R" } }),
      happyDeps({
        markMessageFailed: async () => {
          failedCalls++;
        },
        runTargetChatTool: async () => ({
          artifacts: [
            {
              description: "Target analysis for GLP1R",
              id: "target-msg-1",
              metadata: { _query: "GLP1R", _version: 1 },
              name: "Target: GLP1R",
              type: "target-result" as const,
            },
          ],
          text: "done",
        }),
        updateConversationState: async () => {
          throw new Error("db unavailable");
        },
      })
    );

    const events = await collectEvents(stream);
    const order = events.map((event) => event.event);

    expect(order).toContain("error");
    expect(order).not.toContain("final");
    expect(failedCalls).toBe(1);
  });

  test("target 4xx error emits the friendly detail inline, not the generic fallback", async () => {
    const { TargetChatToolError } = await import("../../services/target/chat-tool");
    let failedCalls = 0;
    const stream = buildChatSseStream(
      baseParams({ toolId: "target", toolInput: { query: "FOOBAR" } }),
      happyDeps({
        markMessageFailed: async () => {
          failedCalls++;
        },
        runTargetChatTool: async () => {
          throw new TargetChatToolError('Could not resolve "FOOBAR" to a UniProt accession', 404);
        },
      })
    );

    const events = await collectEvents(stream);
    const errorEvents = events.filter((event) => event.event === "error");

    // Exactly one error event, carrying the friendly upstream detail — proving it did
    // not fall through to the generic outer catch (which would add a second error).
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0]!.data as { error: string }).error).toBe(
      'Could not resolve "FOOBAR" to a UniProt accession'
    );
    expect(events.map((event) => event.event)).not.toContain("final");
    expect(failedCalls).toBe(1);
  });

  test("target 5xx error stays generic via the outer catch", async () => {
    const { TargetChatToolError } = await import("../../services/target/chat-tool");
    const stream = buildChatSseStream(
      baseParams({ toolId: "target", toolInput: { query: "GLP1R" } }),
      happyDeps({
        runTargetChatTool: async () => {
          throw new TargetChatToolError("Target pipeline error: 500", 502);
        },
      })
    );

    const events = await collectEvents(stream);
    const errorEvents = events.filter((event) => event.event === "error");

    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0]!.data as { error: string }).error).toBe(
      "Something went wrong while generating the response. Please try again."
    );
  });

  test("agent throws BEFORE persistence: markMessageFailed is called", async () => {
    let failedCalls = 0;
    const stream = buildChatSseStream(
      baseParams(),
      happyDeps({
        markMessageFailed: async () => {
          failedCalls++;
        },
        runChatAgent: async () => {
          throw new Error("agent crashed");
        },
      })
    );

    const events = await collectEvents(stream);
    expect(events.map((e) => e.event)).toContain("error");
    expect(failedCalls).toBe(1);
  });

  test("catch path: stream closes even when markMessageFailed rejects (no heartbeat leak)", async () => {
    // Regression for PR #179 review (discussion_r3247661092): if the agent
    // throws and markMessageFailed ALSO rejects, the heartbeat interval must
    // still be cleared and the stream must terminate. Prior to the fix the
    // exception escaped start(), safeClose() never ran, and the timer kept
    // firing against a closed controller.
    const stream = buildChatSseStream(
      baseParams(),
      happyDeps({
        markMessageFailed: async () => {
          throw new Error("DB unavailable");
        },
        runChatAgent: async () => {
          throw new Error("agent crashed");
        },
      })
    );

    // collectEvents reads to completion — if the stream never closes, this
    // hangs. The bun:test timeout would surface the regression.
    const events = await collectEvents(stream);
    expect(events.map((e) => e.event)).toContain("error");
  });
});
