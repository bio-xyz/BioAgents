/**
 * Shared paper-generation lifecycle.
 *
 * Wraps generatePaperFromConversation with the queue-mode status
 * transitions (pending -> processing -> completed/failed) and exposes
 * onProgress/onSuccess/onError hooks for the caller to attach transport-
 * specific side-effects (BullMQ progress, pub/sub notifications, ...).
 *
 * The sync route path calls generatePaperFromConversation directly — it
 * manages its own paper row internally (insert at processing, delete on
 * failure) and has no progress/notification concerns. This lifecycle is
 * the queue worker's executor.
 */

import logger from "../../utils/logger";
import type { PaperGenerationStage } from "../queue/types";
import { generatePaperFromConversation } from "./generatePaper";

export const PAPER_STAGE_PROGRESS: Record<PaperGenerationStage, number> = {
  bibliography: 75,
  cleanup: 100,
  compilation: 90,
  discoveries: 60,
  figures: 30,
  latex_assembly: 80,
  metadata: 20,
  upload: 95,
  validating: 5,
};

export interface PaperLifecycleProgressEvent {
  paperId: string;
  conversationId: string;
  stage: PaperGenerationStage;
  percent: number;
}

export interface PaperLifecycleSuccessEvent {
  paperId: string;
  conversationId: string;
  pdfPath: string;
  pdfUrl?: string;
  rawLatexUrl?: string;
  responseTime: number;
}

export interface PaperLifecycleErrorEvent {
  paperId: string;
  conversationId: string;
  errorMessage: string;
}

export interface PaperLifecycleHooks {
  onProgress?: (event: PaperLifecycleProgressEvent) => Promise<void>;
  onSuccess?: (event: PaperLifecycleSuccessEvent) => Promise<void>;
  onError?: (event: PaperLifecycleErrorEvent) => Promise<void>;
}

export interface PaperLifecycleParams {
  conversationId: string;
  userId: string;
  /** Pre-created paper row, required (queue route inserts it before enqueueing). */
  paperId: string;
}

export interface PaperLifecycleResult {
  paperId: string;
  conversationId: string;
  pdfPath: string;
  pdfUrl?: string;
  rawLatexUrl?: string;
  responseTime: number;
}

export async function runPaperGenerationLifecycle(
  params: PaperLifecycleParams,
  hooks?: PaperLifecycleHooks
): Promise<PaperLifecycleResult> {
  const { conversationId, userId, paperId } = params;
  const startTime = Date.now();

  const { getServiceClient } = await import("../../db/client");
  const supabase = getServiceClient();

  // pending -> processing
  await supabase.from("paper").update({ status: "processing" }).eq("id", paperId);

  try {
    const result = await generatePaperFromConversation(
      conversationId,
      userId,
      paperId,
      async (stage) => {
        const percent = PAPER_STAGE_PROGRESS[stage] ?? 0;
        await supabase.from("paper").update({ progress: { percent, stage } }).eq("id", paperId);
        if (hooks?.onProgress) {
          try {
            await hooks.onProgress({ conversationId, paperId, percent, stage });
          } catch (hookErr) {
            logger.warn({ hookErr, paperId, stage }, "paper_lifecycle_on_progress_hook_failed");
          }
        }
      }
    );

    await supabase
      .from("paper")
      .update({
        pdf_path: result.pdfPath,
        progress: { percent: 100, stage: "cleanup" },
        status: "completed",
      })
      .eq("id", paperId);

    const responseTime = Date.now() - startTime;
    const successEvent: PaperLifecycleSuccessEvent = {
      conversationId,
      paperId,
      pdfPath: result.pdfPath,
      pdfUrl: result.pdfUrl,
      rawLatexUrl: result.rawLatexUrl,
      responseTime,
    };
    if (hooks?.onSuccess) {
      try {
        await hooks.onSuccess(successEvent);
      } catch (hookErr) {
        logger.warn({ hookErr, paperId }, "paper_lifecycle_on_success_hook_failed");
      }
    }
    return successEvent;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    try {
      await supabase
        .from("paper")
        .update({ error: errorMessage, status: "failed" })
        .eq("id", paperId);
    } catch (updateErr) {
      logger.error({ paperId, updateErr }, "paper_lifecycle_failed_status_update_failed");
    }

    if (hooks?.onError) {
      try {
        await hooks.onError({ conversationId, errorMessage, paperId });
      } catch (hookErr) {
        logger.warn(
          { hookErr, originalError: errorMessage, paperId },
          "paper_lifecycle_on_error_hook_failed"
        );
      }
    }
    throw err;
  }
}
