import { getMimeTypeFromFilename, getStorageProvider } from "../../storage";
import logger from "../../utils/logger";
import type { Dataset } from "./index";

/**
 * Analyze data using Edison AI agent for deep analysis
 */
export async function analyzeWithEdison(
  objective: string,
  datasets: Dataset[],
  userId: string,
  conversationStateId: string,
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
  const finalQuery = await formatQueryWithDatasets(
    objective,
    datasets,
    userId,
    conversationStateId,
  );

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

  logger.info({ taskId: taskResponse.task_id }, "edison_analysis_completed");

  return result.answer || "No answer received from Edison";
}

/**
 * Format the analysis query with dataset information
 * Handles multiple datasets
 */
async function formatQueryWithDatasets(
  objective: string,
  datasets: Dataset[],
  userId: string,
  conversationStateId: string,
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

      // Fetch file content from storage
      try {
        const fileContent = await fetchFileFromStorage(
          dataset.filename,
          userId,
          conversationStateId,
        );
        if (fileContent) {
          parts.push(
            `Content (first 5000 chars):\n${fileContent.slice(0, 5000)}`,
          );
        }
      } catch (error) {
        logger.warn(
          { error, filename: dataset.filename },
          "failed_to_fetch_file_content",
        );
        parts.push(`Note: Could not fetch file content`);
      }

      return parts.join("\n");
    }),
  );

  return `${objective}

Available Datasets:
${datasetInfo.join("\n\n")}`;
}

/**
 * Fetch file content from storage bucket
 */
async function fetchFileFromStorage(
  filename: string,
  userId: string,
  conversationStateId: string,
): Promise<string | null> {
  const storageProvider = getStorageProvider();

  if (!storageProvider) {
    logger.warn("No storage provider configured, cannot fetch file content");
    return null;
  }

  try {
    const buffer = await storageProvider.fetchFileFromUserStorage(
      userId,
      conversationStateId,
      filename,
    );

    // Parse the file to get text content
    const { parseFile } = await import("../fileUpload/parsers");
    const parsed = await parseFile(
      buffer,
      filename,
      getMimeTypeFromFilename(filename),
    );

    return parsed.text;
  } catch (error) {
    logger.error(
      { error, filename, userId, conversationStateId },
      "failed_to_download_file_from_storage",
    );
    throw error;
  }
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
