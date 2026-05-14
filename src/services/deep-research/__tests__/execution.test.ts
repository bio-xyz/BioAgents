import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConversationState, PlanTask } from "../../../types/core";
import { runExecutionPhase } from "../phases/execution";

// Ensure literature env vars don't activate the optional sub-agents during
// these tests — we only want the primary literature path.
const ORIG_OPEN = process.env.OPENSCHOLAR_API_URL;
const ORIG_KNOW = process.env.KNOWLEDGE_DOCS_PATH;
beforeEach(() => {
  delete process.env.OPENSCHOLAR_API_URL;
  delete process.env.KNOWLEDGE_DOCS_PATH;
});
afterEach(() => {
  if (ORIG_OPEN) process.env.OPENSCHOLAR_API_URL = ORIG_OPEN;
  if (ORIG_KNOW) process.env.KNOWLEDGE_DOCS_PATH = ORIG_KNOW;
});

describe("runExecutionPhase", () => {
  test("LITERATURE task: calls primary literature agent, mutates task, writes through chain", async () => {
    const task: PlanTask = {
      datasets: [],
      id: "lit-1",
      level: 1,
      objective: "Search rapamycin",
      type: "LITERATURE",
    };
    const conversationState: ConversationState = {
      id: "cs-1",
      values: { objective: "x", plan: [task] } as ConversationState["values"],
    };

    let writes = 0;
    let notifies = 0;

    await runExecutionPhase(
      {
        conversationState,
        newLevel: 1,
        tasksToExecute: [task],
        userId: "u",
      },
      {
        assertNotCancelled: async () => undefined,
        literatureAgent: async (input) => ({
          count: 5,
          jobId: "edison-job-1",
          output: `literature for "${input.objective}"`,
          proteinStructures: [],
        }),
        notifyStateUpdated: async () => {
          notifies++;
        },
        writeStateSerialized: async () => {
          writes++;
        },
      }
    );

    expect(task.start).toBeDefined();
    expect(task.end).toBeDefined();
    expect(task.output).toContain('literature for "Search rapamycin"');
    expect(task.jobId).toBe("edison-job-1");
    // At least start-write + primary-write + end-write
    expect(writes).toBeGreaterThanOrEqual(3);
    // Start + end notifications
    expect(notifies).toBeGreaterThanOrEqual(2);
  });

  test("ANALYSIS task: calls analysisAgent, populates output/artifacts/jobId, fires onAnalysisStarted", async () => {
    const task: PlanTask = {
      datasets: [{ description: "data", filename: "f.csv", id: "d1" }],
      id: "ana-1",
      level: 1,
      objective: "Run analysis",
      type: "ANALYSIS",
    };
    const conversationState: ConversationState = {
      id: "cs-1",
      values: { objective: "x", plan: [task] } as ConversationState["values"],
    };

    let onAnalysisStartedCalled = false;

    await runExecutionPhase(
      {
        conversationState,
        newLevel: 1,
        tasksToExecute: [task],
        userId: "u",
      },
      {
        analysisAgent: async () => ({
          artifacts: [{ filename: "result.csv" }] as unknown as PlanTask["artifacts"],
          jobId: "ana-job-1",
          output: "analysis output",
        }),
        assertNotCancelled: async () => undefined,
        notifyStateUpdated: async () => undefined,
        onAnalysisStarted: async () => {
          onAnalysisStartedCalled = true;
        },
        writeStateSerialized: async () => undefined,
      }
    );

    expect(onAnalysisStartedCalled).toBe(true);
    expect(task.output).toBe("analysis output\n\n");
    expect(task.artifacts).toHaveLength(1);
    expect(task.jobId).toBe("ana-job-1");
    expect(task.start).toBeDefined();
    expect(task.end).toBeDefined();
  });

  test("ANALYSIS failure path: writes 'Analysis failed: <err>' to task.output, still sets end", async () => {
    const task: PlanTask = {
      datasets: [],
      id: "ana-1",
      level: 1,
      objective: "Run analysis",
      type: "ANALYSIS",
    };
    const conversationState: ConversationState = {
      id: "cs-1",
      values: { objective: "x", plan: [task] } as ConversationState["values"],
    };

    await runExecutionPhase(
      {
        conversationState,
        newLevel: 1,
        tasksToExecute: [task],
        userId: "u",
      },
      {
        analysisAgent: async () => {
          throw new Error("edison crashed");
        },
        assertNotCancelled: async () => undefined,
        notifyStateUpdated: async () => undefined,
        writeStateSerialized: async () => undefined,
      }
    );

    expect(task.output).toBe("Analysis failed: edison crashed");
    expect(task.end).toBeDefined();
  });

  test("no tasks: short-circuits without calling any agents or writes", async () => {
    let calls = 0;
    await runExecutionPhase(
      {
        conversationState: { id: "cs", values: { objective: "x" } as ConversationState["values"] },
        newLevel: 0,
        tasksToExecute: [],
        userId: "u",
      },
      {
        analysisAgent: async () => {
          calls++;
          return { output: "x" };
        },
        assertNotCancelled: async () => {
          calls++;
        },
        literatureAgent: async () => {
          calls++;
          return { output: "x" };
        },
        notifyStateUpdated: async () => undefined,
        writeStateSerialized: async () => undefined,
      }
    );

    // assertNotCancelled fires once even with no tasks
    expect(calls).toBe(1);
  });
});
