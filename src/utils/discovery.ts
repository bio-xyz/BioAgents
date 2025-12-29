import type { PlanTask } from "../types/core";
import logger from "./logger";

type DiscoveryRunConfig = {
  shouldRunDiscovery: boolean;
  tasksToConsider: PlanTask[];
};

const DISCOVERY_MESSAGE_COUNT = 4;

/**
 * Determines if discovery agent should run and which tasks to consider
 * Discovery runs only in deep research mode when there are 3+ previous messages (messageCount >= 4)
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
  // Run discovery if messageCount >= 4 (current + 3 previous)
  const hasEnoughMessages = messageCount >= DISCOVERY_MESSAGE_COUNT;

  if (!hasEnoughMessages) {
    logger.info({ messageCount }, "skipping_discovery_insufficient_messages");
    return {
      shouldRunDiscovery: false,
      tasksToConsider: [],
    };
  }

  // If this is the first discovery run (exactly 4 messages), consider all tasks
  // Otherwise, consider only new tasks from current iteration
  let tasksToConsider: PlanTask[];
  if (messageCount === 4) {
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
      analysisTasks: tasksWithOutput.filter((t) => t.type === "ANALYSIS").length,
      literatureTasks: tasksWithOutput.filter((t) => t.type === "LITERATURE")
        .length,
      isFirstRun: messageCount === 4,
    },
    "discovery_run_configured",
  );

  return {
    shouldRunDiscovery: true,
    tasksToConsider: tasksWithOutput,
  };
}
