import { describe, expect, test } from "bun:test";
import type { ConversationState, Message, PlanTask } from "../../../types/core";
import { runHypothesisPhase } from "../phases/hypothesis";

function makeMessage(): Message {
  return {
    content: "",
    conversation_id: "conv-1",
    question: "Investigate rapamycin.",
    user_id: "user-1",
  };
}

function makeTasks(): PlanTask[] {
  return [
    {
      datasets: [],
      id: "lit-1",
      level: 1,
      objective: "Search rapamycin literature",
      output: "Rapamycin extends lifespan in mice.",
      type: "LITERATURE",
    },
  ];
}

describe("runHypothesisPhase", () => {
  test("calls hypothesisAgent, mutates currentHypothesis, persists when id present", async () => {
    const conversationState: ConversationState = {
      id: "cs-1",
      values: { objective: "Investigate rapamycin." } as ConversationState["values"],
    };

    let persistCalled = false;
    let cancelChecks = 0;

    const result = await runHypothesisPhase(
      {
        completedTasks: makeTasks(),
        conversationState,
        message: makeMessage(),
        objective: "Investigate rapamycin.",
      },
      {
        assertNotCancelled: async () => {
          cancelChecks++;
        },
        hypothesisAgent: async () => ({
          end: "",
          hypothesis: "mTOR inhibition extends lifespan via autophagy",
          mode: "create",
          start: "",
        }),
        persistConversationState: async () => {
          persistCalled = true;
        },
      }
    );

    expect(result).toEqual({
      hypothesis: "mTOR inhibition extends lifespan via autophagy",
      mode: "create",
    });
    expect(conversationState.values.currentHypothesis).toBe(
      "mTOR inhibition extends lifespan via autophagy"
    );
    expect(persistCalled).toBe(true);
    expect(cancelChecks).toBe(1);
  });

  test("skips persist when conversationState has no id", async () => {
    const conversationState: ConversationState = {
      values: { objective: "x" } as ConversationState["values"],
    };

    let persistCalled = false;

    await runHypothesisPhase(
      {
        completedTasks: makeTasks(),
        conversationState,
        message: makeMessage(),
        objective: "x",
      },
      {
        assertNotCancelled: async () => undefined,
        hypothesisAgent: async () => ({
          end: "",
          hypothesis: "stub",
          mode: "create",
          start: "",
        }),
        persistConversationState: async () => {
          persistCalled = true;
        },
      }
    );

    expect(conversationState.values.currentHypothesis).toBe("stub");
    expect(persistCalled).toBe(false);
  });

  test("propagates DeepResearchCancelledError from assertNotCancelled before calling agent", async () => {
    let agentCalled = false;

    await expect(
      runHypothesisPhase(
        {
          completedTasks: [],
          conversationState: { id: "cs", values: {} as ConversationState["values"] },
          message: makeMessage(),
          objective: "x",
        },
        {
          assertNotCancelled: async () => {
            throw new Error("cancelled");
          },
          hypothesisAgent: async () => {
            agentCalled = true;
            return { end: "", hypothesis: "x", mode: "create", start: "" };
          },
          persistConversationState: async () => undefined,
        }
      )
    ).rejects.toThrow("cancelled");

    expect(agentCalled).toBe(false);
  });
});
