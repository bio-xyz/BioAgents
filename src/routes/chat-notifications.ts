import { notifyJobCompleted, notifyMessageUpdated } from "../services/queue/notify";
import type { ProteinStructure } from "../types/core";
import logger from "../utils/logger";

export async function notifyChatReplyCompleted(params: {
  conversationId: string;
  messageId: string;
  proteinStructures?: ProteinStructure[];
}): Promise<void> {
  const jobId = params.messageId;

  try {
    await notifyMessageUpdated(jobId, params.conversationId, params.messageId);
    await notifyJobCompleted(jobId, params.conversationId, params.messageId, undefined, {
      proteinStructures: params.proteinStructures,
    });
  } catch (error) {
    logger.warn({ error, messageId: params.messageId }, "chat_sse_post_reply_notify_failed");
  }
}
