import { describe, expect, test } from "bun:test";
import type { ConversationState, Message, PlanTask } from "../../../types/core";
import { runReflectionDiscoveryPhase } from "../phases/reflection-discovery";

function makeMessage(): Message {
  return {
    content: "",
    conversation_id: "conv-1",
    question: "x",
    user_id: "user-1",
  };
}

function makeTasks(): PlanTask[] {
  return [
    {
      datasets: [],
      id: "lit-1",
      level: 1,
      objective: "Search rapamycin",
      output: "stub",
      type: "LITERATURE",
    },
  ];
}

describe("runReflectionDiscoveryPhase", () => {
  test("applies reflection mutations and persists when discovery is skipped", async () => {
    const conversationState: ConversationState = {
      id: "cs-1",
      values: {
        objective: "x",
        plan: makeTasks(),
      } as ConversationState["values"],
    };

    let persistedWith: { ensureTraceObjective?: string } | undefined;

    const result = await runReflectionDiscoveryPhase(
      {
        completedTasks: makeTasks(),
        conversationState,
        hypothesis: "h",
        message: makeMessage(),
      },
      {
        assertNotCancelled: async () => undefined,
        discoveryAgent: async () => {
          throw new Error("discovery should not run");
        },
        getDiscoveryRunConfig: () => ({ shouldRunDiscovery: false, tasksToConsider: [] }),
        getMessagesByConversation: async () => [{ id: "m1" }],
        getObjectiveTraceObjective: (_v, fb) => fb,
        persistConversationState: async (opts) => {
          persistedWith = opts;
        },
        reflectionAgent: async () => ({
          conversationTitle: "Title #42",
          currentObjective: "evolved",
          end: "",
          evolvingObjective: "still evolving",
          keyInsights: ["a", "b"],
          methodology: "method-X",
          start: "",
        }),
      }
    );

    expect(result.reflectionResult.keyInsights).toEqual(["a", "b"]);
    expect(result.discoveryResult).toBeNull();
    expect(conversationState.values.conversationTitle).toBe("Title #42");
    expect(conversationState.values.currentObjective).toBe("evolved");
    expect(conversationState.values.evolvingObjective).toBe("still evolving");
    expect(conversationState.values.keyInsights).toEqual(["a", "b"]);
    expect(conversationState.values.methodology).toBe("method-X");
    expect(conversationState.values.discoveries).toBeUndefined();
    expect(persistedWith?.ensureTraceObjective).toBe("evolved");
  });

  test("applies discovery mutations when getDiscoveryRunConfig opts in", async () => {
    const conversationState: ConversationState = {
      id: "cs-1",
      values: { objective: "x", plan: [] } as ConversationState["values"],
    };

    const result = await runReflectionDiscoveryPhase(
      {
        completedTasks: makeTasks(),
        conversationState,
        hypothesis: "h",
        message: makeMessage(),
      },
      {
        assertNotCancelled: async () => undefined,
        discoveryAgent: async () => ({
          discoveries: [
            {
              claim: "new finding",
              evidenceArray: [],
              id: "d1",
              summary: "sum",
              title: "T",
            },
          ] as unknown as NonNullable<ConversationState["values"]["discoveries"]>,
          end: "",
          start: "",
        }),
        getDiscoveryRunConfig: () => ({ shouldRunDiscovery: true, tasksToConsider: makeTasks() }),
        getMessagesByConversation: async () => Array.from({ length: 5 }, (_, i) => ({ id: i })),
        getObjectiveTraceObjective: (_v, fb) => fb,
        persistConversationState: async () => undefined,
        reflectionAgent: async () => ({
          end: "",
          keyInsights: [],
          start: "",
        }),
      }
    );

    expect(result.discoveryResult?.discoveries).toHaveLength(1);
    expect(conversationState.values.discoveries).toHaveLength(1);
  });

  test("skips persist when conversationState has no id", async () => {
    const conversationState: ConversationState = {
      values: { objective: "x", plan: [] } as ConversationState["values"],
    };

    let persistCalled = false;

    await runReflectionDiscoveryPhase(
      {
        completedTasks: [],
        conversationState,
        hypothesis: "h",
        message: makeMessage(),
      },
      {
        assertNotCancelled: async () => undefined,
        discoveryAgent: async () => ({ discoveries: [], end: "", start: "" }),
        getDiscoveryRunConfig: () => ({ shouldRunDiscovery: false, tasksToConsider: [] }),
        getMessagesByConversation: async () => [],
        getObjectiveTraceObjective: () => undefined,
        persistConversationState: async () => {
          persistCalled = true;
        },
        reflectionAgent: async () => ({ end: "", keyInsights: [], start: "" }),
      }
    );

    expect(persistCalled).toBe(false);
  });
});
