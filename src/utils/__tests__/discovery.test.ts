import { describe, expect, test } from "bun:test";
import type { PlanTask } from "../../types/core";
import { getDiscoveryRunConfig } from "../discovery";

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    datasets: [],
    level: 1,
    objective: "Test",
    output: "Some output",
    type: "LITERATURE",
    ...overrides,
  };
}

describe("getDiscoveryRunConfig", () => {
  test("skips discovery when messageCount < 3", () => {
    const result = getDiscoveryRunConfig(2, [makeTask()], [makeTask()]);
    expect(result.shouldRunDiscovery).toBe(false);
    expect(result.tasksToConsider).toHaveLength(0);
  });

  test("considers all tasks on first discovery run (messageCount === 3)", () => {
    const allTasks = [makeTask(), makeTask({ type: "ANALYSIS" })];
    const newTasks = [makeTask({ type: "ANALYSIS" })];
    const result = getDiscoveryRunConfig(3, allTasks, newTasks);
    expect(result.shouldRunDiscovery).toBe(true);
    expect(result.tasksToConsider).toHaveLength(2);
  });

  test("considers only new tasks on subsequent runs (messageCount > 3)", () => {
    const allTasks = [makeTask(), makeTask(), makeTask()];
    const newTasks = [makeTask({ objective: "New task" })];
    const result = getDiscoveryRunConfig(5, allTasks, newTasks);
    expect(result.shouldRunDiscovery).toBe(true);
    expect(result.tasksToConsider).toHaveLength(1);
  });

  test("skips when tasks have no output", () => {
    const tasks = [makeTask({ output: "" }), makeTask({ output: "   " })];
    const result = getDiscoveryRunConfig(3, tasks, tasks);
    expect(result.shouldRunDiscovery).toBe(false);
  });

  test("filters out tasks without output", () => {
    const allTasks = [makeTask({ output: "has output" }), makeTask({ output: "" })];
    const result = getDiscoveryRunConfig(3, allTasks, []);
    expect(result.shouldRunDiscovery).toBe(true);
    expect(result.tasksToConsider).toHaveLength(1);
  });
});
