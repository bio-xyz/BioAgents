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
