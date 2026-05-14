import { describe, expect, test } from "bun:test";
import type { ConversationState, Message, PlanTask } from "../../../types/core";
import { runContinuationPrepPhase } from "../phases/continuation-prep";

function makeMessage(id = "msg-1"): Message {
  return { content: "", conversation_id: "c", id, question: "q", user_id: "u" };
}

describe("runContinuationPrepPhase", () => {
  test("promotes suggestions, mutates state, calls createContinuationMessage", async () => {
    const suggested: PlanTask[] = [
      { datasets: [], id: "stale-1", objective: "A", type: "LITERATURE" },
      { datasets: [], id: "stale-2", objective: "B", type: "ANALYSIS" },
    ];
    const existingPlan: PlanTask[] = [
      { datasets: [], id: "lit-0", level: 0, objective: "old", output: "x", type: "LITERATURE" },
    ];

    const conversationState: ConversationState = {
      id: "cs-1",
      values: {
        objective: "x",
        plan: existingPlan,
        suggestedNextSteps: suggested,
      } as ConversationState["values"],
    };

    let activityCalled = false;
    const result = await runContinuationPrepPhase(
      {
        conversationState,
        currentMessage: makeMessage("prev-msg"),
        currentObjective: "x",
        stateId: "state-1",
        userMessage: "hello",
      },
      {
        assertNotCancelled: async () => undefined,
        createContinuationMessage: async (_prev, _stateId) => makeMessage("new-msg"),
        getObjectiveTraceObjective: (_v, fb) => fb,
        persistConversationActivity: async () => {
          activityCalled = true;
        },
      }
    );

    expect(result.newMessage.id).toBe("new-msg");
    expect(result.nextLevel).toBe(1);
    expect(result.promotedTasks).toHaveLength(2);
    expect(result.promotedTasks[0]?.id).toBe("lit-1");
    expect(result.promotedTasks[1]?.id).toBe("ana-1");
    expect(
      result.promotedTasks.every((t) => t.level === 1 && !t.start && !t.end && !t.output)
    ).toBe(true);

    // State mutations
    expect(conversationState.values.plan).toHaveLength(3); // existing + 2 promoted
    expect(conversationState.values.suggestedNextSteps).toEqual([]);
    expect(conversationState.values.currentLevel).toBe(1);
    expect(activityCalled).toBe(true);
  });

  test("works when conversationState has no existing plan (nextLevel=0)", async () => {
    const conversationState: ConversationState = {
      id: "cs-1",
      values: {
        objective: "x",
        suggestedNextSteps: [{ datasets: [], id: "s", objective: "A", type: "LITERATURE" }],
      } as ConversationState["values"],
    };

    const result = await runContinuationPrepPhase(
      {
        conversationState,
        currentMessage: makeMessage(),
        currentObjective: "x",
        stateId: "state-1",
        userMessage: "hi",
      },
      {
        assertNotCancelled: async () => undefined,
        createContinuationMessage: async () => makeMessage("new"),
        getObjectiveTraceObjective: () => undefined,
        persistConversationActivity: async () => undefined,
      }
    );

    expect(result.nextLevel).toBe(0);
    expect(conversationState.values.currentLevel).toBe(0);
    expect(result.promotedTasks[0]?.id).toBe("lit-0");
  });
});
