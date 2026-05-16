import { describe, expect, test } from "bun:test";
import type { ConversationState, Message, PlanTask } from "../../../types/core";
import { runContinueDecisionPhase } from "../phases/continue-decision";

function makeMessage(): Message {
  return { content: "", conversation_id: "c", question: "q", user_id: "u" };
}

const stubSuggestions: PlanTask[] = [
  { datasets: [], id: "lit-3", objective: "next", type: "LITERATURE" },
];

describe("runContinueDecisionPhase", () => {
  test("returns continue when agent approves and iteration cap not hit", async () => {
    const conversationState: ConversationState = {
      values: { suggestedNextSteps: stubSuggestions } as ConversationState["values"],
    };

    const result = await runContinueDecisionPhase(
      {
        completedTasks: [],
        conversationState,
        hypothesis: "h",
        iterationCount: 1,
        loopAlive: true,
        maxAutoIterations: 5,
        message: makeMessage(),
        researchMode: "semi-autonomous",
      },
      {
        assertNotCancelled: async () => undefined,
        continueResearchAgent: async () => ({
          confidence: "high",
          reasoning: "more to learn",
          shouldContinue: true,
        }),
      }
    );

    expect(result).toEqual({ isFinal: false, shouldContinueLoop: true, willContinue: true });
  });

  test("returns stop when agent declines", async () => {
    const conversationState: ConversationState = {
      values: { suggestedNextSteps: stubSuggestions } as ConversationState["values"],
    };

    const result = await runContinueDecisionPhase(
      {
        completedTasks: [],
        conversationState,
        hypothesis: "h",
        iterationCount: 1,
        loopAlive: true,
        maxAutoIterations: 5,
        message: makeMessage(),
        researchMode: "semi-autonomous",
      },
      {
        assertNotCancelled: async () => undefined,
        continueResearchAgent: async () => ({
          confidence: "high",
          reasoning: "stop",
          shouldContinue: false,
        }),
      }
    );

    expect(result).toEqual({ isFinal: true, shouldContinueLoop: false, willContinue: false });
  });

  test("short-circuits to stop when no suggestedNextSteps", async () => {
    const conversationState: ConversationState = {
      values: { objective: "x", suggestedNextSteps: [] } as ConversationState["values"],
    };

    const result = await runContinueDecisionPhase(
      {
        completedTasks: [],
        conversationState,
        hypothesis: "h",
        iterationCount: 1,
        loopAlive: true,
        maxAutoIterations: 5,
        message: makeMessage(),
        researchMode: "semi-autonomous",
      },
      {
        assertNotCancelled: async () => undefined,
        continueResearchAgent: async () => {
          throw new Error("agent should not be called");
        },
      }
    );

    expect(result).toEqual({ isFinal: true, shouldContinueLoop: false, willContinue: false });
  });

  test("short-circuits to stop when iterationCount hit cap", async () => {
    const conversationState: ConversationState = {
      values: { suggestedNextSteps: stubSuggestions } as ConversationState["values"],
    };

    const result = await runContinueDecisionPhase(
      {
        completedTasks: [],
        conversationState,
        hypothesis: "h",
        iterationCount: 5,
        loopAlive: true,
        maxAutoIterations: 5,
        message: makeMessage(),
        researchMode: "semi-autonomous",
      },
      {
        assertNotCancelled: async () => undefined,
        continueResearchAgent: async () => {
          throw new Error("agent should not be called");
        },
      }
    );

    expect(result.shouldContinueLoop).toBe(false);
  });
});
