import { updateState } from "../../db/operations";
import type { Message, State } from "../../types/core";
import logger from "../../utils/logger";
import { endStep, startStep } from "../../utils/state";

type EdisonJobType = "LITERATURE" | "ANALYSIS" | "PRECEDENT" | "MOLECULES";

type EdisonTaskResponse = {
  task_id: string;
  status: string;
  job_type: string;
};

export const edisonTool = {
  name: "EDISON",
  description:
    "Execute deep research using Edison AI agent for literature search, precedent analysis, data analysis, and molecular tasks",
  enabled: true,
  deepResearchEnabled: true, // Enable for deep research
  execute: async (input: {
    state: State;
    conversationState?: State;
    message: Message;
    question: string;
    jobType?: EdisonJobType;
  }) => {
    const { state, conversationState, message, question, jobType } = input;

    const EDISON_API_URL = process.env.EDISON_API_URL;
    if (!EDISON_API_URL) {
      logger.error("EDISON_API_URL not configured");
      throw new Error("EDISON_API_URL is not configured");
    }

    const EDISON_API_KEY = process.env.EDISON_API_KEY;
    if (!EDISON_API_KEY) {
      logger.error("EDISON_API_KEY not configured");
      throw new Error("EDISON_API_KEY is not configured");
    }

    // Get job type from input, environment, or default to LITERATURE
    const selectedJobType: EdisonJobType =
      jobType || (process.env.EDISON_JOB_TYPE as EdisonJobType) || "LITERATURE";

    startStep(state, "EDISON_" + selectedJobType);

    // Update state in DB after startStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        logger.error({ err }, "failed_to_update_state");
      }
    }

    logger.info({ jobType: selectedJobType, question }, "starting_edison_task");

    try {
      // Start single Edison task
      const taskResponse = await startEdisonTask(
        EDISON_API_URL,
        EDISON_API_KEY,
        selectedJobType,
        question,
      );

      logger.info(
        {
          taskId: taskResponse.task_id,
          jobType: selectedJobType,
        },
        "edison_task_started_awaiting_completion",
      );

      // Await this specific task to complete
      const results = await awaitEdisonTasks(EDISON_API_URL, EDISON_API_KEY, [
        {
          taskId: taskResponse.task_id,
          jobType: taskResponse.job_type,
          question: question,
          status: taskResponse.status,
        },
      ]);

      // Extract result (will be empty array if timed out)
      const result = results.length > 0 ? results[0] : null;

      logger.info(
        {
          taskId: taskResponse.task_id,
          hasAnswer: !!result?.answer,
          hasError: !!result?.error,
        },
        "edison_task_completed",
      );

      // Save result to state
      const edisonResult = {
        taskId: taskResponse.task_id,
        jobType: selectedJobType,
        question: question,
        answer: result?.answer,
        error: result?.error,
      };

      // Get existing Edison results or initialize empty array
      const existingResults = state.values.edisonResults || [];
      state.values.edisonResults = [...existingResults, edisonResult];

      endStep(state, "EDISON_" + selectedJobType);

      if (state.id) {
        await updateState(state.id, state.values);
      }

      return {
        question: question,
        answer: result?.answer,
        error: result?.error,
        message: result?.answer
          ? `Edison ${selectedJobType} task completed successfully`
          : `Edison ${selectedJobType} task failed or timed out`,
      };
    } catch (err) {
      logger.error({ err }, "edison_execution_failed");

      endStep(state, "EDISON_" + selectedJobType);

      if (state.id) {
        await updateState(state.id, state.values);
      }

      throw err;
    }
  },
};

/**
 * Start an async Edison task
 */
async function startEdisonTask(
  apiUrl: string,
  apiKey: string,
  jobType: EdisonJobType,
  query: string,
): Promise<EdisonTaskResponse> {
  const endpoint = `${apiUrl}/api/v1/edison/run/async`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
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
 * Await all Edison tasks to complete by polling their status
 * Returns empty array if timeout is reached (10 minutes max)
 */
export async function awaitEdisonTasks(
  apiUrl: string,
  apiKey: string,
  tasks: Array<{
    taskId: string;
    jobType: string;
    question: string;
    status: string;
  }>,
): Promise<Array<{ question: string; answer?: string; error?: string }>> {
  const MAX_WAIT_TIME = 20 * 60 * 1000; // 20 minutes max wait
  const POLL_INTERVAL = 3000; // Poll every 3 seconds
  const startTime = Date.now();

  const results: Array<{ question: string; answer?: string; error?: string }> =
    [];
  let timedOut = false;

  // Poll each task until completion
  await Promise.all(
    tasks.map(async (task) => {
      const result: { question: string; answer?: string; error?: string } = {
        question: task.question,
      };

      let completed = false;

      while (!completed) {
        // Check timeout
        if (Date.now() - startTime > MAX_WAIT_TIME) {
          logger.warn({ taskId: task.taskId }, "edison_task_timeout");
          timedOut = true;
          return;
        }

        try {
          // Poll status endpoint
          const response = await fetch(
            `${apiUrl}/api/v1/edison/task/${task.taskId}/status`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
              },
            },
          );

          if (!response.ok) {
            const errorText = await response.text();
            logger.error(
              { taskId: task.taskId, status: response.status, errorText },
              "edison_status_check_failed",
            );
            result.error = `Failed to check status: ${response.status}`;
            results.push(result);
            return;
          }

          const statusData = await response.json();
          const status = statusData.status;

          logger.debug(
            { taskId: task.taskId, status },
            "edison_task_status_check",
          );

          if (status === "success") {
            result.answer = statusData.answer || "";
            results.push(result);
            completed = true;
          } else if (status === "failed") {
            result.error = statusData.error || "Task failed";
            results.push(result);
            completed = true;
          } else if (status === "queued" || status === "in progress") {
            // Still processing, wait and poll again
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
          } else {
            // Unknown status
            logger.warn(
              { taskId: task.taskId, status },
              "edison_unknown_status",
            );
            result.error = `Unknown status: ${status}`;
            results.push(result);
            completed = true;
          }
        } catch (err) {
          logger.error(
            { err, taskId: task.taskId },
            "edison_status_poll_error",
          );
          result.error = err instanceof Error ? err.message : "Unknown error";
          results.push(result);
          return;
        }
      }
    }),
  );

  // Return empty array if any task timed out
  if (timedOut) {
    logger.warn(
      { taskCount: tasks.length },
      "edison_tasks_timed_out_returning_empty",
    );
    return [];
  }

  return results;
}
