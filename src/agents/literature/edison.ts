import logger from "../../utils/logger";
import {
  startEdisonTask,
  awaitEdisonTask,
} from "../../utils/edison";

/**
 * Search using Edison AI agent for deep literature search
 */
export async function searchEdison(
  objective: string,
): Promise<{ output: string; jobId: string }> {
  const EDISON_API_URL = process.env.EDISON_API_URL;
  const EDISON_API_KEY = process.env.EDISON_API_KEY;

  if (!EDISON_API_URL || !EDISON_API_KEY) {
    throw new Error("Edison API URL or API key not configured");
  }

  logger.info({ objective }, "starting_edison_literature_search");

  // Start Edison task with LITERATURE job type
  const taskResponse = await startEdisonTask(
    EDISON_API_URL,
    EDISON_API_KEY,
    "LITERATURE",
    objective,
  );

  logger.info(
    { taskId: taskResponse.task_id },
    "edison_task_started_awaiting_completion",
  );

  // Poll for task completion
  const result = await awaitEdisonTask(
    EDISON_API_URL,
    EDISON_API_KEY,
    taskResponse.task_id,
  );

  if (result.error) {
    throw new Error(`Edison task failed: ${result.error}`);
  }

  logger.info(
    { taskId: taskResponse.task_id },
    "edison_literature_search_completed",
  );

  return {
    output: result.answer || "No answer received from Edison",
    jobId: taskResponse.task_id,
  };
}
