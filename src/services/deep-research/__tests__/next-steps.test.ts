import { describe, expect, test } from "bun:test";
import type { ConversationState, Message, PlanTask, State } from "../../../types/core";
import { runNextStepsPhase } from "../phases/next-steps";

function makeMessage(): Message {
  return { content: "", conversation_id: "c", question: "q", user_id: "u" };
}

function makeState(): State {
  return { id: "s", values: {} };
}

const stubTasks: PlanTask[] = [
  {
    datasets: [],
    id: "lit-2",
    objective: "Investigate downstream",
    type: "LITERATURE",
  },
];

describe("runNextStepsPhase", () => {
  test("returns hasSuggestions=true and persists when planning yields tasks", async () => {
    const conversationState: ConversationState = {
      id: "cs-1",
      values: {
        objective: "x",
        suggestedNextSteps: [{ datasets: [], id: "stale", objective: "old", type: "LITERATURE" }],
      } as ConversationState["values"],
    };

    let activityCalls = 0;
    let persistCalls = 0;

    const result = await runNextStepsPhase(
      {
        conversationState,
        currentObjective: "current",
        message: makeMessage(),
        newLevel: 2,
        researchMode: "semi-autonomous",
        state: makeState(),
      },
      {
        assertNotCancelled: async () => undefined,
        getObjectiveTraceObjective: (_v, fb) => fb,
        persistConversationActivity: async () => {
          activityCalls++;
        },
        persistConversationState: async () => {
          persistCalls++;
        },
        planningAgent: async () => ({
          currentObjective: "next-evolved",
          plan: stubTasks,
        }),
      }
    );

    expect(result.hasSuggestions).toBe(true);
    expect(result.suggestedNextSteps).toEqual(stubTasks);
    expect(result.nextObjective).toBe("next-evolved");
    expect(conversationState.values.suggestedNextSteps).toEqual(stubTasks);
    expect(conversationState.values.currentObjective).toBe("next-evolved");
    expect(activityCalls).toBe(1);
    expect(persistCalls).toBe(1);
  });

  test("returns hasSuggestions=false when planning yields empty plan", async () => {
    const conversationState: ConversationState = {
      id: "cs-1",
      values: {
        objective: "x",
        suggestedNextSteps: [{ datasets: [], id: "stale", objective: "old", type: "LITERATURE" }],
      } as ConversationState["values"],
    };

    const result = await runNextStepsPhase(
      {
        conversationState,
        currentObjective: "current",
        message: makeMessage(),
        newLevel: 2,
        researchMode: "semi-autonomous",
        state: makeState(),
      },
      {
        assertNotCancelled: async () => undefined,
        getObjectiveTraceObjective: () => undefined,
        persistConversationActivity: async () => undefined,
        persistConversationState: async () => {
          throw new Error("persistConversationState should not be called when plan empty");
        },
        planningAgent: async () => ({ currentObjective: "x", plan: [] }),
      }
    );

    expect(result.hasSuggestions).toBe(false);
    // Stale suggestions are still cleared
    expect(conversationState.values.suggestedNextSteps).toEqual([]);
  });
});
