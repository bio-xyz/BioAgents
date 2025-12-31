import type { PlanTask } from "../types/core";
import logger from "./logger";

type DiscoveryRunConfig = {
  shouldRunDiscovery: boolean;
  tasksToConsider: PlanTask[];
};

const DISCOVERY_MESSAGE_COUNT = 3;

/**
 * Determines if discovery agent should run and which tasks to consider
 * Discovery runs only in deep research mode when there are 2+ previous messages (messageCount >= 3)
 * and there are completed tasks with outputs
 *
 * @param messageCount - Total number of messages in conversation (including current)
 * @param allTasks - All tasks in the plan
 * @param newTasks - New tasks from current iteration
 * @returns Configuration for discovery agent run
 */
export function getDiscoveryRunConfig(
  messageCount: number,
  allTasks: PlanTask[],
  newTasks: PlanTask[],
): DiscoveryRunConfig {
  // Run discovery if messageCount >= 3 (current + 2 previous)
  const hasEnoughMessages = messageCount >= DISCOVERY_MESSAGE_COUNT;

  if (!hasEnoughMessages) {
    logger.info({ messageCount }, "skipping_discovery_insufficient_messages");
    return {
      shouldRunDiscovery: false,
      tasksToConsider: [],
    };
  }

  // If this is the first discovery run (exactly 3 messages), consider all tasks
  // Otherwise, consider only new tasks from current iteration
  let tasksToConsider: PlanTask[];
  if (messageCount === DISCOVERY_MESSAGE_COUNT) {
    tasksToConsider = allTasks;
  } else {
    tasksToConsider = newTasks;
  }

  // Check if there are any tasks with outputs to consider
  const tasksWithOutput = tasksToConsider.filter(
    (task) => task.output && task.output.trim(),
  );

  if (tasksWithOutput.length === 0) {
    logger.info(
      {
        taskCount: tasksToConsider.length,
        tasksWithOutput: 0,
      },
      "skipping_discovery_no_task_outputs",
    );
    return {
      shouldRunDiscovery: false,
      tasksToConsider: [],
    };
  }

  logger.info(
    {
      taskCount: tasksWithOutput.length,
      analysisTasks: tasksWithOutput.filter((t) => t.type === "ANALYSIS")
        .length,
      literatureTasks: tasksWithOutput.filter((t) => t.type === "LITERATURE")
        .length,
      isFirstRun: messageCount === DISCOVERY_MESSAGE_COUNT,
    },
    "discovery_run_configured",
  );

  return {
    shouldRunDiscovery: true,
    tasksToConsider: tasksWithOutput,
  };
}
