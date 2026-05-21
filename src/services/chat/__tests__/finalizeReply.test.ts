import { describe, expect, test } from "bun:test";
import type { ConversationState, ProteinStructure } from "../../../types/core";
import { finalizeChatReply } from "../finalizeReply";

function baseConversationState(): ConversationState {
  return {
    id: "cs-1",
    values: { objective: "x" } as ConversationState["values"],
  };
}

describe("finalizeChatReply", () => {
  test("hitMaxTokens returns truncated and skips markMessageComplete", async () => {
    let completeCalls = 0;
    const outcome = await finalizeChatReply(
      {
        agentResult: { hitMaxTokens: true, replyText: "partial" },
        conversationState: baseConversationState(),
        messageId: "msg-1",
        startTime: Date.now(),
      },
      {
        markMessageComplete: async () => {
          completeCalls++;
          return { updated: true };
        },
      }
    );
    expect(outcome.kind).toBe("truncated");
    expect(completeCalls).toBe(0);
  });

  test("empty replyText returns empty and skips markMessageComplete", async () => {
    let completeCalls = 0;
    const outcome = await finalizeChatReply(
      {
        agentResult: { replyText: "" },
        conversationState: baseConversationState(),
        messageId: "msg-1",
        startTime: Date.now(),
      },
      {
        markMessageComplete: async () => {
          completeCalls++;
          return { updated: true };
        },
      }
    );
    expect(outcome.kind).toBe("empty");
    expect(completeCalls).toBe(0);
  });

  test("happy path returns completed with responseTime + replyText", async () => {
    const start = Date.now() - 100;
    const outcome = await finalizeChatReply(
      {
        agentResult: { replyText: "hi" },
        conversationState: baseConversationState(),
        messageId: "msg-1",
        startTime: start,
      },
      {
        markMessageComplete: async () => ({ updated: true }),
        updateConversationState: async () => undefined,
      }
    );
    expect(outcome.kind).toBe("completed");
    if (outcome.kind === "completed") {
      expect(outcome.replyText).toBe("hi");
      expect(outcome.responseTime).toBeGreaterThanOrEqual(100);
    }
  });

  test("updated:false from markMessageComplete returns save_skipped", async () => {
    let updateCalls = 0;
    const outcome = await finalizeChatReply(
      {
        agentResult: {
          proteinStructures: [],
          replyText: "hi",
        },
        conversationState: baseConversationState(),
        messageId: "msg-1",
        startTime: Date.now(),
      },
      {
        markMessageComplete: async () => ({ updated: false }),
        updateConversationState: async () => {
          updateCalls++;
        },
      }
    );
    expect(outcome.kind).toBe("save_skipped");
    expect(updateCalls).toBe(0); // protein write must NOT happen on save_skipped
  });

  test("persists protein structures via updateConversationState on completed", async () => {
    const protein: ProteinStructure = {
      averagePlddt: 80,
      bcifUrl: "https://example.com/x.bcif",
      entryId: "AF-X-F1",
      entryUrl: "https://example.com/x",
      title: "X",
    };
    let updateCalls = 0;
    const cs = baseConversationState();
    const outcome = await finalizeChatReply(
      {
        agentResult: { proteinStructures: [protein], replyText: "hi" },
        conversationState: cs,
        messageId: "msg-1",
        startTime: Date.now(),
      },
      {
        markMessageComplete: async () => ({ updated: true }),
        updateConversationState: async () => {
          updateCalls++;
        },
      }
    );
    expect(outcome.kind).toBe("completed");
    expect(updateCalls).toBe(1);
  });

  test("updateConversationState failure does not mask completion", async () => {
    const protein: ProteinStructure = {
      averagePlddt: 80,
      bcifUrl: "https://example.com/x.bcif",
      entryId: "AF-X-F1",
      entryUrl: "https://example.com/x",
      title: "X",
    };
    const outcome = await finalizeChatReply(
      {
        agentResult: { proteinStructures: [protein], replyText: "hi" },
        conversationState: baseConversationState(),
        messageId: "msg-1",
        startTime: Date.now(),
      },
      {
        markMessageComplete: async () => ({ updated: true }),
        updateConversationState: async () => {
          throw new Error("DB write failed");
        },
      }
    );
    expect(outcome.kind).toBe("completed"); // protein write failure does NOT downgrade
  });

  test("no protein structures: updateConversationState is not called", async () => {
    let updateCalls = 0;
    const outcome = await finalizeChatReply(
      {
        agentResult: { replyText: "hi" },
        conversationState: baseConversationState(),
        messageId: "msg-1",
        startTime: Date.now(),
      },
      {
        markMessageComplete: async () => ({ updated: true }),
        updateConversationState: async () => {
          updateCalls++;
        },
      }
    );
    expect(outcome.kind).toBe("completed");
    expect(updateCalls).toBe(0);
  });
});
