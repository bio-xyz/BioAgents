import { describe, expect, test } from "bun:test";
import type { ConversationState, Message, PlanTask, State } from "../../../types/core";
import { runReplyPhase } from "../phases/reply";

function makeMessage(): Message {
  return { content: "", conversation_id: "c", id: "msg-1", question: "q", user_id: "u" };
}

function makeState(): State {
  return { id: "s", values: {} };
}

const completedTasks: PlanTask[] = [
  {
    datasets: [],
    id: "lit-1",
    level: 1,
    objective: "search",
    output: "stub literature output",
    type: "LITERATURE",
  },
];

describe("runReplyPhase", () => {
  test("calls replyAgent, persists reply, writes finalResponse when isFinal", async () => {
    const conversationState: ConversationState = {
      id: "cs-1",
      values: {
        objective: "x",
        plan: completedTasks,
      } as ConversationState["values"],
    };

    let markCalledWith:
      | { id: string; content: string; response_time: number; summary?: string }
      | undefined;
    let notifyCalled = false;
    let persistCalled = false;
    let activityCalled = false;

    const result = await runReplyPhase(
      {
        conversationState,
        currentMessage: makeMessage(),
        currentObjective: "x",
        hypothesis: "h",
        isFinal: true,
        iterationCount: 1,
        iterationStartTime: Date.now() - 100,
        newLevel: 1,
        sessionStartLevel: 0,
        state: makeState(),
      },
      {
        assertNotCancelled: async () => undefined,
        markMessageComplete: async (id, update) => {
          markCalledWith = { id, ...update };
          return { updated: true };
        },
        notifyMessageUpdated: async () => {
          notifyCalled = true;
        },
        persistConversationActivity: async () => {
          activityCalled = true;
        },
        persistConversationState: async () => {
          persistCalled = true;
        },
        replyAgent: async () => ({
          end: "",
          reply: "Stub reply text.",
          start: "",
          summary: "stub summary",
        }),
      }
    );

    expect(result.reply).toBe("Stub reply text.");
    expect(result.updated).toBe(true);
    expect(activityCalled).toBe(true);
    expect(markCalledWith?.content).toBe("Stub reply text.");
    expect(markCalledWith?.id).toBe("msg-1");
    expect(markCalledWith?.summary).toBe("stub summary");
    expect(conversationState.values.finalResponse).toBe("Stub reply text.");
    expect(persistCalled).toBe(true);
    expect(notifyCalled).toBe(true);
  });

  test("does NOT write finalResponse or persist state when isFinal=false", async () => {
    const conversationState: ConversationState = {
      id: "cs-1",
      values: { objective: "x", plan: [] } as ConversationState["values"],
    };

    let persistCalled = false;

    await runReplyPhase(
      {
        conversationState,
        currentMessage: makeMessage(),
        currentObjective: "x",
        hypothesis: "h",
        isFinal: false,
        iterationCount: 2,
        iterationStartTime: Date.now(),
        newLevel: 1,
        sessionStartLevel: 0,
        state: makeState(),
      },
      {
        assertNotCancelled: async () => undefined,
        markMessageComplete: async () => ({ updated: true }),
        notifyMessageUpdated: async () => undefined,
        persistConversationActivity: async () => undefined,
        persistConversationState: async () => {
          persistCalled = true;
        },
        replyAgent: async () => ({ end: "", reply: "intermediate", start: "" }),
      }
    );

    expect(conversationState.values.finalResponse).toBeUndefined();
    expect(persistCalled).toBe(false);
  });

  test("returns updated=false when markMessageComplete reports row no longer PENDING", async () => {
    const result = await runReplyPhase(
      {
        conversationState: {
          id: "cs",
          values: { objective: "x", plan: [] } as ConversationState["values"],
        },
        currentMessage: makeMessage(),
        currentObjective: "x",
        hypothesis: "h",
        isFinal: true,
        iterationCount: 1,
        iterationStartTime: Date.now(),
        newLevel: 0,
        sessionStartLevel: 0,
        state: makeState(),
      },
      {
        assertNotCancelled: async () => undefined,
        markMessageComplete: async () => ({ updated: false }),
        notifyMessageUpdated: async () => undefined,
        persistConversationActivity: async () => undefined,
        persistConversationState: async () => undefined,
        replyAgent: async () => ({ end: "", reply: "x", start: "" }),
      }
    );

    expect(result.updated).toBe(false);
  });
});
