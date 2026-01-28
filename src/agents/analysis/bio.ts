import {
  getConversationBasePath,
  getStorageProvider,
  isStorageProviderAvailable,
} from "../../storage";
import { type AnalysisArtifact } from "../../types/core";
import { fetchWithRetry } from "../../utils/fetchWithRetry";
import logger from "../../utils/logger";
import type { Dataset } from "./index";

type BioDataAnalysisResult = {
  id: string;
  status: string;
  success: boolean;
  answer: string;
  artifacts: Array<AnalysisArtifact>;
};

type BioAnalysisConfig = {
  apiUrl: string;
  apiKey: string;
  supportsSharedStorage: boolean;
};

type BioTaskContext = {
  userId: string;
  conversationStateId: string;
  datasets: Dataset[];
};

/**
 * Get Bio analysis configuration from environment
 */
function getBioConfig(): BioAnalysisConfig {
  const apiUrl = process.env.DATA_ANALYSIS_API_URL;
  if (!apiUrl) {
    throw new Error("DATA_ANALYSIS_API_URL is not configured");
  }

  const apiKey = process.env.DATA_ANALYSIS_API_KEY;
  if (!apiKey) {
    throw new Error("DATA_ANALYSIS_API_KEY is not configured");
  }

  const supportsSharedStorage =
    process.env.DATA_ANALYSIS_SUPPORTS_STORAGE !== "false" &&
    isStorageProviderAvailable();

  return { apiUrl, apiKey, supportsSharedStorage };
}

/**
 * Analyze data using Bio Data Analysis agent for deep analysis
 */
export async function analyzeWithBio(
  objective: string,
  datasets: Dataset[],
  userId: string,
  conversationStateId: string,
): Promise<{
  output: string;
  artifacts: Array<AnalysisArtifact>;
  jobId: string;
}> {
  if (!objective) {
    logger.error("No question provided to Data Analysis Agent");
    throw new Error("No question provided to Data Analysis Agent");
  }

  const config = getBioConfig();
  const context: BioTaskContext = { userId, conversationStateId, datasets };

  // Only download dataset content if shared storage is not available
  if (!config.supportsSharedStorage) {
    await downloadDatasetContent(context);
  }

  const query = await formatQueryWithDatasets(objective, datasets);

  logger.info(
    { query, datasetCount: datasets.length },
    "starting_bio_analysis",
  );

  let taskResult: BioDataAnalysisResult;
  let taskId: string | undefined;
  try {
    const taskResponse = await startBioTask(config, context, query);
    taskId = taskResponse.id;
    logger.info({ taskId }, "bio_analysis_task_started");
    taskResult = await awaitBioTask(config, taskId);
  } catch (err) {
    logger.error(
      { err, objective, datasetCount: datasets.length },
      "bio_analysis_task_failed",
    );
    return {
      output: `Error performing Bio data analysis: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
      artifacts: [],
      jobId: taskId || "unknown",
    };
  }

  return {
    output: taskResult.answer,
    artifacts: taskResult.artifacts || [],
    jobId: taskId!,
  };
}

/**
 * Format the analysis query with dataset information
 * @param objective - The analysis objective
 * @param datasets - The datasets to include
 * @returns
 */
async function formatQueryWithDatasets(
  objective: string,
  datasets: Dataset[],
): Promise<string> {
  let datasetInfo = "";
  for (const dataset of datasets) {
    datasetInfo += `Dataset: ${dataset.filename}\nDescription: ${dataset.description}\nDataset ID: ${dataset.id}\n\n`;
  }

  const finalQuery = `Objective: ${objective}\n\nDatasets:\n${datasetInfo}`;
  return finalQuery;
}

/**
 * Populate dataset content by downloading files from storage
 */
async function downloadDatasetContent(context: BioTaskContext): Promise<void> {
  const storageProvider = getStorageProvider();

  if (!storageProvider) {
    logger.warn("No storage provider configured, cannot fetch file content");
    return;
  }

  const { userId, conversationStateId, datasets } = context;

  await Promise.all(
    datasets.map(async (dataset) => {
      if (!dataset.path) {
        logger.warn(
          { datasetId: dataset.id, filename: dataset.filename },
          "skipping_dataset_no_artifact_path",
        );
        return;
      }
      try {
        const fileBuffer = await storageProvider.fetchFileByRelativePath(
          userId,
          conversationStateId,
          dataset.path,
        );
        dataset.content = fileBuffer;
      } catch (err) {
        logger.error(
          { err, datasetId: dataset.id, filename: dataset.filename },
          "failed_to_fetch_dataset_content",
        );
      }
    }),
  );
}

/**
 * Build form data for Bio task based on storage configuration
 */
function buildTaskFormData(
  config: BioAnalysisConfig,
  context: BioTaskContext,
  query: string,
): FormData {
  const formData = new FormData();
  formData.append("task_description", query);

  const { userId, conversationStateId, datasets } = context;

  if (config.supportsSharedStorage) {
    const basePath = getConversationBasePath(userId, conversationStateId);
    formData.append("base_path", basePath);
    for (const dataset of datasets) {
      if (dataset.path) {
        formData.append("file_paths", dataset.path);
      }
    }
  } else {
    for (const dataset of datasets) {
      if (dataset.content) {
        const blob = new Blob([new Uint8Array(dataset.content)]);
        formData.append("data_files", blob, dataset.filename);
      }
    }
  }

  return formData;
}

/**
 * Start Bio data analysis task
 */
async function startBioTask(
  config: BioAnalysisConfig,
  context: BioTaskContext,
  query: string,
): Promise<BioDataAnalysisResult> {
  const endpoint = `${config.apiUrl}/api/task/run/async`;
  const formData = buildTaskFormData(config, context, query);

  const { response } = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: { "X-API-Key": config.apiKey },
      body: formData,
    },
    {
      onRetry: (attempt, error) =>
        logger.warn({ attempt, error: error.message }, "bio_task_start_retry"),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      { status: response.status, statusText: response.statusText, errorText },
      "bio_task_start_failed",
    );
    throw new Error(
      `Failed to start Bio data analysis task: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as BioDataAnalysisResult;
}

/**
 * Await completion of a Bio data analysis task
 */
async function awaitBioTask(
  config: BioAnalysisConfig,
  taskId: string,
): Promise<BioDataAnalysisResult> {
  const timeoutMinutes = parseInt(
    process.env.BIO_ANALYSIS_TASK_TIMEOUT_MINUTES || "60",
    10,
  );
  const MAX_WAIT_TIME = timeoutMinutes * 60 * 1000;
  const POLL_INTERVAL = 10000; // Poll every 10 seconds
  const startTime = Date.now();

  const endpoint = `${config.apiUrl}/api/task/${taskId}`;

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const { response } = await fetchWithRetry(
      endpoint,
      {
        method: "GET",
        headers: { "X-API-Key": config.apiKey },
      },
      {
        onRetry: (attempt, error) =>
          logger.warn({ attempt, taskId, error: error.message }, "bio_task_poll_retry"),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, errorText, taskId },
        "failed_to_fetch_bio_task_status",
      );
      throw new Error(
        `Failed to fetch Bio task status: ${response.status} - ${errorText}`,
      );
    }

    const taskResult = (await response.json()) as BioDataAnalysisResult;

    if (taskResult.status === "completed" && taskResult.success === true) {
      logger.info({ taskId }, "task_completed_successfully");
      return taskResult;
    }

    if (taskResult.status === "failed" || taskResult.success === false) {
      logger.error({ taskId }, "bio_analysis_task_failed");
      return taskResult;
    }

    logger.info(
      { taskId, status: taskResult.status },
      "bio_analysis_task_still_running",
    );

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  // Timeout reached
  logger.error({ taskId }, "bio_analysis_task_timeout");
  throw new Error(
    `Bio data analysis task timed out after ${MAX_WAIT_TIME / 60000} minutes`,
  );
}
