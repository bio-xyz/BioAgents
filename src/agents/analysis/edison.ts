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
): Promise<{ output: string }> {
  const EDISON_API_URL = process.env.EDISON_API_URL;
  const EDISON_API_KEY = process.env.EDISON_API_KEY;

  if (!EDISON_API_URL || !EDISON_API_KEY) {
    throw new Error("Edison API URL or API key not configured");
  }

  logger.info(
    { objective, datasetCount: datasets.length },
    "starting_edison_analysis",
  );

  // Upload files to Edison storage and get entry IDs
  const dataStorageEntryIds = await uploadFilesToEdison(
    EDISON_API_URL,
    EDISON_API_KEY,
    datasets,
    userId,
    conversationStateId,
  );

  logger.info(
    { dataStorageEntryIds, datasetCount: datasets.length },
    "files_uploaded_to_edison_storage",
  );

  // Format query with dataset information (no file content)
  const finalQuery = formatQueryWithDatasetInfo(objective, datasets);

  // Start Edison task with ANALYSIS job type and storage entry IDs
  const taskResponse = await startEdisonTask(
    EDISON_API_URL,
    EDISON_API_KEY,
    "ANALYSIS",
    finalQuery,
    dataStorageEntryIds,
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

  return {
    output: result.answer || "No answer received from Edison",
  };
}

/**
 * Upload files to Edison data storage service
 * Returns array of storage entry IDs
 */
async function uploadFilesToEdison(
  apiUrl: string,
  apiKey: string,
  datasets: Dataset[],
  userId: string,
  conversationStateId: string,
): Promise<string[]> {
  if (!datasets || datasets.length === 0) {
    return [];
  }

  const entryIds: string[] = [];

  for (const dataset of datasets) {
    try {
      // Fetch file from storage
      const fileBuffer = await fetchFileBufferFromStorage(
        dataset.filename,
        userId,
        conversationStateId,
      );

      if (!fileBuffer) {
        logger.warn(
          { filename: dataset.filename },
          "skipping_file_upload_no_buffer",
        );
        continue;
      }

      // Create FormData for file upload
      const formData = new FormData();
      // @ts-ignore
      const blob = new Blob([fileBuffer], {
        type: getMimeTypeFromFilename(dataset.filename),
      });
      formData.append("file", blob, dataset.filename);
      formData.append("name", dataset.filename);
      formData.append(
        "description",
        dataset.description || `Dataset: ${dataset.filename}`,
      );

      // Upload to Edison storage
      const endpoint = `${apiUrl}/api/v1/edison/storage/upload/file`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { filename: dataset.filename, status: response.status, errorText },
          "edison_file_upload_failed",
        );
        throw new Error(
          `Failed to upload ${dataset.filename}: ${response.status} - ${errorText}`,
        );
      }

      const uploadResult = await response.json();
      entryIds.push(uploadResult.entry_id);

      logger.info(
        { filename: dataset.filename, entryId: uploadResult.entry_id },
        "file_uploaded_to_edison",
      );
    } catch (error) {
      logger.error(
        { error, filename: dataset.filename },
        "failed_to_upload_file_to_edison",
      );
      throw error;
    }
  }

  return entryIds;
}

/**
 * Format the analysis query with dataset information
 * Does not include file content - files are uploaded separately
 */
function formatQueryWithDatasetInfo(
  objective: string,
  datasets: Dataset[],
): string {
  if (!datasets || datasets.length === 0) {
    return objective;
  }

  const datasetInfo = datasets.map((dataset, index) => {
    const parts = [`Dataset ${index + 1}: ${dataset.filename}`];

    if (dataset.description) {
      parts.push(`Description: ${dataset.description}`);
    }

    parts.push(`ID: ${dataset.id}`);

    return parts.join("\n");
  });

  return `${objective}

Available Datasets:
${datasetInfo.join("\n\n")}

Note: Full dataset files have been uploaded and are available for analysis.`;
}

/**
 * Fetch file buffer from storage bucket (raw file content)
 */
async function fetchFileBufferFromStorage(
  filename: string,
  userId: string,
  conversationStateId: string,
): Promise<Buffer | null> {
  const storageProvider = getStorageProvider();

  if (!storageProvider) {
    logger.warn("No storage provider configured, cannot fetch file");
    return null;
  }

  try {
    const buffer = await storageProvider.fetchFileFromUserStorage(
      userId,
      conversationStateId,
      filename,
    );

    return buffer;
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
  dataStorageEntryIds?: string[],
): Promise<{ task_id: string; status: string; job_type: string }> {
  const endpoint = `${apiUrl}/api/v1/edison/run/async`;

  const requestBody: {
    name: string;
    query: string;
    data_storage_entry_ids?: string[];
  } = {
    name: jobType,
    query,
  };

  // Add data storage entry IDs if provided
  if (dataStorageEntryIds && dataStorageEntryIds.length > 0) {
    requestBody.data_storage_entry_ids = dataStorageEntryIds;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
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
