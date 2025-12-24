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
 * AND at least one ANALYSIS task has been completed
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

  // Check if there are any ANALYSIS tasks in the tasks to consider
  const hasAnalysisTasks = tasksToConsider.some(
    (task) => task.type === "ANALYSIS" && task.output && task.output.trim(),
  );

  if (!hasAnalysisTasks) {
    logger.info(
      {
        taskCount: tasksToConsider.length,
        hasAnalysisTasks: false,
      },
      "skipping_discovery_no_analysis_tasks",
    );
    return {
      shouldRunDiscovery: false,
      tasksToConsider: [],
    };
  }

  logger.info(
    {
      taskCount: tasksToConsider.length,
      analysisTasks: tasksToConsider.filter((t) => t.type === "ANALYSIS")
        .length,
      literatureTasks: tasksToConsider.filter((t) => t.type === "LITERATURE")
        .length,
      isFirstRun: messageCount === 4,
    },
    "discovery_run_configured",
  );

  return {
    shouldRunDiscovery: true,
    tasksToConsider,
  };
}
