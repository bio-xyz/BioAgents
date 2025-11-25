import logger from "../../utils/logger";

type Dataset = {
  filename: string;
  id: string;
  description: string;
};

/**
 * Analyze data using Edison AI agent for deep analysis
 */
export async function analyzeWithEdison(
  objective: string,
  datasets: Dataset[],
): Promise<string> {
  const EDISON_API_URL = process.env.EDISON_API_URL;
  const EDISON_API_KEY = process.env.EDISON_API_KEY;

  if (!EDISON_API_URL || !EDISON_API_KEY) {
    throw new Error("Edison API URL or API key not configured");
  }

  logger.info(
    { objective, datasetCount: datasets.length },
    "starting_edison_analysis",
  );

  // Format query with dataset information
  const finalQuery = await formatQueryWithDatasets(objective, datasets);

  // Start Edison task with ANALYSIS job type
  const taskResponse = await startEdisonTask(
    EDISON_API_URL,
    EDISON_API_KEY,
    "ANALYSIS",
    finalQuery,
  );

  logger.info(
    { taskId: taskResponse.task_id, datasetCount: datasets.length },
    "edison_analysis_task_started_awaiting_completion",
  );

  // Poll for task completion
  const result = await awaitEdisonTask(
    EDISON_API_URL,
    EDISON_API_KEY,
    taskResponse.task_id,
  );

  if (result.error) {
    throw new Error(`Edison analysis task failed: ${result.error}`);
  }

  logger.info(
    { taskId: taskResponse.task_id },
    "edison_analysis_completed",
  );

  return result.answer || "No answer received from Edison";
}

/**
 * Format the analysis query with dataset information
 * Handles multiple datasets
 */
async function formatQueryWithDatasets(
  objective: string,
  datasets: Dataset[],
): Promise<string> {
  if (!datasets || datasets.length === 0) {
    return objective;
  }

  const datasetInfo = await Promise.all(
    datasets.map(async (dataset, index) => {
      const parts = [`Dataset ${index + 1}: ${dataset.filename}`];

      if (dataset.description) {
        parts.push(`Description: ${dataset.description}`);
      }

      parts.push(`ID: ${dataset.id}`);

      // TODO: Fetch file content using dataset.id
      // const fileContent = await fetchFileContentById(dataset.id);
      // if (fileContent) {
      //   parts.push(`MIME Type: ${fileContent.mimeType}`);
      //   parts.push(`Content:\n${fileContent.parsedText}`);
      // }

      return parts.join("\n");
    }),
  );

  return `${objective}

Available Datasets:
${datasetInfo.join("\n\n")}`;
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
      logger.warn({ taskId }, "edison_analysis_task_timeout");
      return { error: "Analysis task timed out after 20 minutes" };
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
          "edison_analysis_status_check_failed",
        );
        return { error: `Failed to check status: ${response.status}` };
      }

      const statusData = await response.json();
      const status = statusData.status;

      logger.debug({ taskId, status }, "edison_analysis_task_status_check");

      if (status === "success") {
        return { answer: statusData.answer || "" };
      } else if (status === "failed") {
        return { error: statusData.error || "Analysis task failed" };
      } else if (status === "queued" || status === "in progress") {
        // Still processing, wait and poll again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      } else {
        // Unknown status
        logger.warn({ taskId, status }, "edison_analysis_unknown_status");
        return { error: `Unknown status: ${status}` };
      }
    } catch (err) {
      logger.error({ err, taskId }, "edison_analysis_status_poll_error");
      return { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }
}
