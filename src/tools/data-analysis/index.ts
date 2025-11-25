import { updateState } from "../../db/operations";
import type {
  ConversationState,
  DataAnalysisResult,
  Message,
  State,
  Tool,
  UploadedFile,
} from "../../types/core";
import logger from "../../utils/logger";
import { endStep, startStep } from "../../utils/state";

const dataAnalysisTool: Tool = {
  name: "DATA_ANALYSIS",
  description:
    "Execute data science tasks including data analysis, visualization, and reporting using uploaded datasets",
  enabled: true,
  deepResearchEnabled: true,
  execute: async (input: {
    state: State;
    conversationState?: ConversationState;
    message: Message;
    [key: string]: any;
  }) => {
    const { state, conversationState } = input;

    if (process.env.PRIMARY_ANALYSIS_AGENT !== "bio") {
      logger.warn(
        "Data Analysis Agent is disabled when PRIMARY_ANALYSIS_AGENT is not set to 'bio'",
      );
      return;
    }

    const question = input.message?.question || input.question;
    if (!question) {
      logger.error("No question provided to Data Analysis Agent");
      return;
    }

    const DATA_ANALYSIS_API_URL = process.env.DATA_ANALYSIS_API_URL;
    if (!DATA_ANALYSIS_API_URL) {
      logger.error("DATA_ANALYSIS_API_URL not configured");
      throw new Error("DATA_ANALYSIS_API_URL is not configured");
    }

    const DATA_ANALYSIS_API_KEY = process.env.DATA_ANALYSIS_API_KEY;
    if (!DATA_ANALYSIS_API_KEY) {
      logger.error("DATA_ANALYSIS_API_KEY not configured");
      throw new Error("DATA_ANALYSIS_API_KEY is not configured");
    }

    startStep(state, "DATA_ANALYSIS");

    // Update state in DB after startStep
    if (state.id) {
      await updateState(state.id, state.values);
    }

    logger.info({ question }, "starting_data_analysis_task");

    const datasets = conversationState?.values.uploadedDatasets || [];

    const datasetInfo =
      datasets
        .map((file: UploadedFile) => {
          return `Available datasets:
Dataset ID: ${file.id} 
Filename: ${file.filename}
Upload Path: ${file.path}
MIME Type: ${file.mimeType}
Meta-data: ${JSON.stringify(file.metadata)}`;
        })
        .join("\n\n") || "";

    try {
      // Start task
      const taskResponse = await startTask(
        DATA_ANALYSIS_API_URL,
        DATA_ANALYSIS_API_KEY,
        question,
        datasetInfo,
        state.values.rawFiles,
      );

      logger.info(
        taskResponse,
        "data_analysis_task_started_awaiting_completion",
      );

      // Await this specific task to complete
      const taskResult = await awaitTask(
        DATA_ANALYSIS_API_URL,
        DATA_ANALYSIS_API_KEY,
        taskResponse.id,
      );
      taskResult.question = question;

      logger.info(
        {
          taskId: taskResponse.id,
          success: taskResponse.success,
        },
        "data_analysis_task_completed",
      );

      // Get existing result or initialize empty array
      const existingResults = state.values.dataAnalysisResults || [];
      state.values.dataAnalysisResults = [...existingResults, taskResult];
      return taskResult;
    } catch (err) {
      logger.error({ err }, "data_analysis_task_execution_failed");

      throw err;
    } finally {
      endStep(state, "DATA_ANALYSIS");

      // Update state in DB after endStep
      if (state.id) {
        await updateState(state.id, state.values);
      }
    }
  },
};

/**
 * Start an async Data scientist task
 */
async function startTask(
  apiUrl: string,
  apiKey: string,
  query: string,
  dataFilesDescription: string,
  rawFiles?: any[],
): Promise<DataAnalysisResult> {
  const endpoint = `${apiUrl}/api/task/run/async`;

  const formData = new FormData();
  formData.append("task_description", query);
  formData.append("data_files_description", dataFilesDescription);

  // Append each file individually with the field name 'data_files'
  if (rawFiles && rawFiles.length > 0) {
    for (const file of rawFiles) {
      const blob = new Blob([file.buffer]);
      formData.append("data_files", blob, file.filename);
    }
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Data Analysis Agent API error: ${response.status} - ${errorText}`,
    );
  }

  return await response.json();
}

/**
 * Await task to complete by polling status
 * Returns task result when completed or throws error on timeout
 */
export async function awaitTask(
  apiUrl: string,
  apiKey: string,
  task_id: string,
): Promise<DataAnalysisResult> {
  const MAX_WAIT_TIME = 20 * 60 * 1000; // 20 minutes max wait
  const POLL_INTERVAL = 3000; // Poll every 3 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const endpoint = `${apiUrl}/api/task/${task_id}`;

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, error: errorText },
          "failed_to_fetch_task_status",
        );
        throw new Error(
          `Failed to fetch task status: ${response.status} - ${errorText}`,
        );
      }

      const taskStatus: DataAnalysisResult = await response.json();

      // Check if task is completed
      if (taskStatus.status === "completed" && taskStatus.success === true) {
        logger.info({ task_id }, "task_completed_successfully");
        return taskStatus;
      }

      // Check if task has failed or not successful
      if (taskStatus.status === "failed" || taskStatus.success === false) {
        logger.error({ task_id, taskStatus }, "task_failed");
        return taskStatus;
      }

      // Task is still running, wait before polling again
      logger.debug(
        { task_id, status: taskStatus.status },
        "task_still_running",
      );
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    } catch (err) {
      logger.error({ err, task_id }, "error_polling_task_status");
      throw err;
    }
  }

  // Timeout reached
  logger.error({ task_id }, "task_timeout_reached");
  throw new Error(
    `Task ${task_id} did not complete within ${MAX_WAIT_TIME / 1000} seconds`,
  );
}

export default dataAnalysisTool;
export { dataAnalysisTool };
