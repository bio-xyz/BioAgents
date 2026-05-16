import logger from "../../utils/logger";
import type { FileStatusRecord } from "./status";

export interface FileLifecycleSuccessEvent {
  status: FileStatusRecord;
  description: string;
}

export interface FileLifecycleErrorEvent {
  status: FileStatusRecord;
  errorMessage: string;
}

export interface FileLifecycleHooks {
  onSuccess?: (event: FileLifecycleSuccessEvent) => Promise<void>;
  onError?: (event: FileLifecycleErrorEvent) => Promise<void>;
}

/**
 * Build the in-process onError handler used by `confirmUpload`. Transitions
 * status to "error" so callers observing getFileStatus see a terminal
 * failure instead of an indefinitely-pinned "uploaded". Wrapped in a try so
 * a failing status write only logs — the original processFile error is
 * still rethrown by the lifecycle.
 */
export function buildInProcessFileErrorHandler(
  fileId: string,
  updateFileStatus: (id: string, update: { error: string; status: "error" }) => Promise<unknown>
): (event: FileLifecycleErrorEvent) => Promise<void> {
  return async ({ errorMessage }) => {
    try {
      await updateFileStatus(fileId, { error: errorMessage, status: "error" });
    } catch (updateError) {
      logger.error({ fileId, updateError }, "failed_to_update_file_status_on_error");
    }
  };
}

/**
 * Shared file-processing lifecycle. Runs processFile and dispatches the
 * caller's success/error hooks. Used by both the BullMQ file-process worker
 * (queue mode) and the in-process upload-confirm path so they observe the
 * same execution shape — only the surrounding scheduling differs.
 *
 * Hook failures are logged but do not mask the underlying processFile error.
 */
export async function runFileProcessingLifecycle(
  status: FileStatusRecord,
  hooks?: FileLifecycleHooks
): Promise<{ description: string }> {
  const { processFile } = await import("./index");
  try {
    const result = await processFile(status);
    if (hooks?.onSuccess) {
      try {
        await hooks.onSuccess({ description: result.description, status });
      } catch (hookErr) {
        logger.warn({ fileId: status.fileId, hookErr }, "file_lifecycle_on_success_hook_failed");
      }
    }
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    if (hooks?.onError) {
      try {
        await hooks.onError({ errorMessage, status });
      } catch (hookErr) {
        logger.warn(
          { fileId: status.fileId, hookErr, originalError: errorMessage },
          "file_lifecycle_on_error_hook_failed"
        );
      }
    }
    throw err;
  }
}
