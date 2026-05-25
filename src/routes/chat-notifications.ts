import { notifyJobCompleted, notifyMessageUpdated } from "../services/queue/notify";
import type { DataArtifact, ProteinStructure } from "../types/core";
import logger from "../utils/logger";

export async function notifyChatReplyCompleted(params: {
  conversationId: string;
  artifacts?: DataArtifact[];
  messageId: string;
  proteinStructures?: ProteinStructure[];
}): Promise<void> {
  const jobId = params.messageId;
  const result = {
    ...(params.artifacts?.length ? { artifacts: params.artifacts } : {}),
    ...(params.proteinStructures?.length ? { proteinStructures: params.proteinStructures } : {}),
  };

  try {
    await notifyJobCompleted(jobId, params.conversationId, params.messageId, undefined, result);
  } catch (error) {
    logger.warn({ error, messageId: params.messageId }, "chat_sse_job_completed_notify_failed");
  }

  try {
    await notifyMessageUpdated(jobId, params.conversationId, params.messageId);
  } catch (error) {
    logger.warn({ error, messageId: params.messageId }, "chat_sse_message_updated_notify_failed");
  }
}
