import { describe, expect, test } from "bun:test";
import type { ConversationState, ProteinStructure } from "../../types/core";
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
});
