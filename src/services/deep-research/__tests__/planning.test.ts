import { describe, expect, test } from "bun:test";
import type { ConversationState, Message, PlanTask, State } from "../../../types/core";
import { runPlanningPhase } from "../phases/planning";

function makeMessage(question = "rapamycin"): Message {
  return { content: "", conversation_id: "c", id: "msg", question, user_id: "u" };
}

function makeState(): State {
  return { id: "s", values: {} };
}

describe("runPlanningPhase", () => {
  test("continuation path returns existing level without calling planningAgent", async () => {
    const conversationState: ConversationState = {
      id: "cs",
      values: {
        currentObjective: "carried-over",
        objective: "x",
        plan: [
          { datasets: [], id: "lit-3", level: 3, objective: "old", type: "LITERATURE" },
          { datasets: [], id: "ana-3", level: 3, objective: "old2", type: "ANALYSIS" },
        ],
      } as ConversationState["values"],
    };

    const result = await runPlanningPhase(
      {
        conversationState,
        currentMessage: makeMessage(),
        iterationCount: 2,
        researchMode: "semi-autonomous",
        rootMessage: makeMessage(),
        skipPlanning: true,
        state: makeState(),
      },
      {
        assertNotCancelled: async () => undefined,
        getObjectiveTraceObjective: () => undefined,
        persistConversationState: async () => {
          throw new Error("persist should not run on continuation");
        },
        planningAgent: async () => {
          throw new Error("planningAgent should not run on continuation");
        },
      }
    );

    expect(result.newLevel).toBe(3);
    expect(result.currentObjective).toBe("carried-over");
    expect(result.nextSkipPlanning).toBe(false);
  });

  test("clarification path on iteration 1 promotes pre-approved tasks", async () => {
    const conversationState: ConversationState = {
      id: "cs",
      values: {
        clarificationContext: {
          initialTasks: [
            {
              datasetFilenames: [],
              objective: "Clarified search A",
              sources: [],
              type: "LITERATURE",
            },
          ],
          refinedObjective: "Investigate refined objective",
        },
        objective: "x",
      } as unknown as ConversationState["values"],
    };

    const result = await runPlanningPhase(
      {
        conversationState,
        currentMessage: makeMessage(),
        iterationCount: 1,
        researchMode: "semi-autonomous",
        rootMessage: makeMessage(),
        skipPlanning: false,
        state: makeState(),
      },
      {
        assertNotCancelled: async () => undefined,
        getObjectiveTraceObjective: (_v, fb) => fb,
        persistConversationState: async () => undefined,
        planningAgent: async () => {
          throw new Error("planningAgent should not run on clarification path");
        },
      }
    );

    expect(result.newLevel).toBe(0);
    expect(result.currentObjective).toBe("Investigate refined objective");
    expect(conversationState.values.plan).toHaveLength(1);
    expect(conversationState.values.plan?.[0]?.id).toBe("lit-0");
    // clarification.initialTasks cleared after use
    expect(conversationState.values.clarificationContext?.initialTasks).toBeUndefined();
  });

  test("default path calls planningAgent and appends new tasks at next level", async () => {
    const conversationState: ConversationState = {
      id: "cs",
      values: {
        objective: "x",
        plan: [{ datasets: [], id: "lit-0", level: 0, objective: "prev", type: "LITERATURE" }],
      } as ConversationState["values"],
    };

    let agentCalls = 0;
    const agentTasks: PlanTask[] = [
      { datasets: [], id: "new", objective: "X-search", type: "LITERATURE" },
      { datasets: [], id: "new", objective: "X-analysis", type: "ANALYSIS" },
    ];

    const result = await runPlanningPhase(
      {
        conversationState,
        currentMessage: makeMessage(),
        iterationCount: 1,
        researchMode: "semi-autonomous",
        rootMessage: makeMessage("root q"),
        skipPlanning: false,
        state: makeState(),
      },
      {
        assertNotCancelled: async () => undefined,
        getObjectiveTraceObjective: (_v, fb) => fb,
        persistConversationState: async () => undefined,
        planningAgent: async () => {
          agentCalls++;
          return { currentObjective: "evolved-obj", plan: agentTasks };
        },
      }
    );

    expect(agentCalls).toBe(1);
    expect(result.newLevel).toBe(1);
    expect(result.currentObjective).toBe("evolved-obj");
    expect(conversationState.values.plan).toHaveLength(3);
    expect(conversationState.values.plan?.[1]?.id).toBe("lit-1");
    expect(conversationState.values.plan?.[2]?.id).toBe("ana-1");
    // Default-path side-effect: evolvingObjective seeded from root question
    expect(conversationState.values.evolvingObjective).toBe("root q");
  });

  test("default path throws when agent returns empty plan or objective", async () => {
    await expect(
      runPlanningPhase(
        {
          conversationState: {
            id: "cs",
            values: { objective: "x" } as ConversationState["values"],
          },
          currentMessage: makeMessage(),
          iterationCount: 1,
          researchMode: "semi-autonomous",
          rootMessage: makeMessage(),
          skipPlanning: false,
          state: makeState(),
        },
        {
          assertNotCancelled: async () => undefined,
          getObjectiveTraceObjective: () => undefined,
          persistConversationState: async () => undefined,
          planningAgent: async () => ({ currentObjective: "", plan: [] }),
        }
      )
    ).rejects.toThrow("Plan or current objective not found");
  });
});
