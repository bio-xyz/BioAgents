import { getMimeTypeFromFilename, getStorageProvider } from "../../storage";
import logger from "../../utils/logger";
import {
  startEdisonTask,
  awaitEdisonTask,
} from "../../utils/edison";
import type { Dataset } from "./index";

/**
 * Analyze data using Edison AI agent for deep analysis
 */
export async function analyzeWithEdison(
  objective: string,
  datasets: Dataset[],
  userId: string,
  conversationStateId: string,
): Promise<{ output: string; jobId: string }> {
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
    jobId: taskResponse.task_id,
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
      if (!dataset.path) {
        logger.warn(
          { filename: dataset.filename },
          "skipping_file_no_artifact_path",
        );
        continue;
      }

      const fileBuffer = await fetchFileBufferFromStorage(
        userId,
        conversationStateId,
        dataset.path,
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
 * Fetch file buffer from storage bucket using relative path
 */
async function fetchFileBufferFromStorage(
  userId: string,
  conversationStateId: string,
  relativePath: string,
): Promise<Buffer | null> {
  const storageProvider = getStorageProvider();

  if (!storageProvider) {
    logger.warn("No storage provider configured, cannot fetch file");
    return null;
  }

  try {
    return await storageProvider.fetchFileByRelativePath(
      userId,
      conversationStateId,
      relativePath,
    );
  } catch (error) {
    logger.error(
      { error, userId, conversationStateId, relativePath },
      "failed_to_download_file_from_storage",
    );
    throw error;
  }
}
