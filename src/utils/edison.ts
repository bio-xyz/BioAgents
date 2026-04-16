import { z } from "zod";
import logger from "./logger";

const EdisonTaskResponseSchema = z.object({
  job_type: z.string(),
  status: z.string(),
  task_id: z.string(),
});

const EdisonStatusResponseSchema = z.object({
  answer: z.string().optional(),
  error: z.string().optional(),
  status: z.string(),
});

/**
 * Start an async Edison task
 */
export async function startEdisonTask(
  apiUrl: string,
  apiKey: string,
  jobType: string,
  query: string,
  dataStorageEntryIds?: string[]
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
    body: JSON.stringify(requestBody),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Edison API error: ${response.status} - ${errorText}`);
  }

  const data: unknown = await response.json();
  // Use safeParse so upstream schema drift surfaces as a clear error rather than
  // a raw ZodError crash that bypasses caller error handling.
  const parsed = EdisonTaskResponseSchema.safeParse(data);
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues, raw: data },
      "edison_task_response_schema_mismatch"
    );
    throw new Error("Edison task response shape changed — check logs for schema issues");
  }
  return parsed.data;
}

/**
 * Await single Edison task to complete by polling its status
 */
export async function awaitEdisonTask(
  apiUrl: string,
  apiKey: string,
  taskId: string
): Promise<{ answer?: string; error?: string }> {
  const timeoutMinutes = parseInt(process.env.EDISON_TASK_TIMEOUT_MINUTES || "30", 10);
  const MAX_WAIT_TIME = timeoutMinutes * 60 * 1000;
  const POLL_INTERVAL = 3000; // Poll every 3 seconds
  const startTime = Date.now();

  while (true) {
    // Check timeout
    if (Date.now() - startTime > MAX_WAIT_TIME) {
      logger.warn({ taskId }, "edison_task_timeout");
      return { error: `Task timed out after ${timeoutMinutes} minutes` };
    }

    try {
      // Poll status endpoint
      const response = await fetch(`${apiUrl}/api/v1/edison/task/${taskId}/status`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "GET",
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ errorText, status: response.status, taskId }, "edison_status_check_failed");
        return { error: `Failed to check status: ${response.status}` };
      }

      const raw: unknown = await response.json();
      const parsed = EdisonStatusResponseSchema.safeParse(raw);
      if (!parsed.success) {
        logger.error(
          { issues: parsed.error.issues, raw, taskId },
          "edison_status_response_schema_mismatch"
        );
        return { error: "Edison status response shape changed — check logs" };
      }
      const statusData = parsed.data;
      const status = statusData.status;

      logger.debug({ status, taskId }, "edison_task_status_check");

      if (status === "success") {
        return { answer: statusData.answer ?? "" };
      } else if (status === "failed") {
        return { error: statusData.error ?? "Task failed" };
      } else if (status === "queued" || status === "in progress") {
        // Still processing, wait and poll again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      } else {
        // Unknown status
        logger.warn({ status, taskId }, "edison_unknown_status");
        return { error: `Unknown status: ${status}` };
      }
    } catch (err) {
      logger.error({ err, taskId }, "edison_status_poll_error");
      return { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }
}
