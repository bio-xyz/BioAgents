import logger from "../../utils/logger";

/**
 * Search using Edison AI agent for deep literature search
 */
export async function searchEdison(objective: string): Promise<string> {
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

  return result.answer || "No answer received from Edison";
}

/**
 * Start an async Edison task
 */
async function startEdisonTask(
  apiUrl: string,
  apiKey: string,
  jobType: string,
  query: string,
): Promise<{ task_id: string; status: string; job_type: string }> {
  const endpoint = `${apiUrl}/api/v1/edison/run/async`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name: jobType,
      query,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Edison API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Await single Edison task to complete by polling its status
 */
async function awaitEdisonTask(
  apiUrl: string,
  apiKey: string,
  taskId: string,
): Promise<{ answer?: string; error?: string }> {
  const MAX_WAIT_TIME = 20 * 60 * 1000; // 20 minutes max wait
  const POLL_INTERVAL = 3000; // Poll every 3 seconds
  const startTime = Date.now();

  while (true) {
    // Check timeout
    if (Date.now() - startTime > MAX_WAIT_TIME) {
      logger.warn({ taskId }, "edison_task_timeout");
      return { error: "Task timed out after 20 minutes" };
    }

    try {
      // Poll status endpoint
      const response = await fetch(
        `${apiUrl}/api/v1/edison/task/${taskId}/status`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { taskId, status: response.status, errorText },
          "edison_status_check_failed",
        );
        return { error: `Failed to check status: ${response.status}` };
      }

      const statusData = await response.json();
      const status = statusData.status;

      logger.debug({ taskId, status }, "edison_task_status_check");

      if (status === "success") {
        return { answer: statusData.answer || "" };
      } else if (status === "failed") {
        return { error: statusData.error || "Task failed" };
      } else if (status === "queued" || status === "in progress") {
        // Still processing, wait and poll again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      } else {
        // Unknown status
        logger.warn({ taskId, status }, "edison_unknown_status");
        return { error: `Unknown status: ${status}` };
      }
    } catch (err) {
      logger.error({ err, taskId }, "edison_status_poll_error");
      return { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }
}
