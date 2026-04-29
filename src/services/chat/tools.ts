import { createMessage, updateMessage } from "../../db/operations";
import logger from "../../utils/logger";

export interface MessageCreationParams {
  conversationId: string;
  userId: string;
  message: string;
  source: string;
  stateId: string;
  files: File[];
  isExternal?: boolean; // Deprecated, kept for compatibility
}

/**
 * Create message record
 */
export async function createMessageRecord(params: MessageCreationParams): Promise<{
  success: boolean;
  message?: Awaited<ReturnType<typeof createMessage>>;
  error?: string;
}> {
  const { conversationId, userId, message, source, stateId, files } = params;

  try {
    const fileMetadata =
      files.length > 0
        ? files.map((f) => ({
            name: f.name,
            size: f.size,
            type: f.type,
          }))
        : undefined;

    const createdMessage = await createMessage({
      content: "",
      conversation_id: conversationId,
      files: fileMetadata,
      question: message,
      source,
      state_id: stateId,
      user_id: userId,
    });

    if (logger) {
      logger.info({ messageId: createdMessage.id }, "message_created");
    }

    return { message: createdMessage, success: true };
  } catch (err) {
    if (logger) logger.error({ err }, "create_message_failed");
    return { error: "Failed to create message", success: false };
  }
}

/**
 * Update message response time
 */
export async function updateMessageResponseTime(
  messageId: string,
  responseTime: number
): Promise<void> {
  try {
    await updateMessage(messageId, {
      response_time: responseTime,
    });
  } catch (err) {
    if (logger) logger.error({ err }, "failed_to_update_response_time");
  }
}

/**
 * Best-effort transition of a message row to FAILED. Guarded so callers
 * can't accidentally downgrade a COMPLETE row — the UPDATE only matches
 * rows that aren't already terminal-COMPLETE. Never throws; if the UPDATE
 * itself fails, the periodic sweeper catches stale PENDING rows later.
 */
export async function markMessageFailed(messageId: string): Promise<void> {
  try {
    const { getServiceClient } = await import("../../db/client");
    const supabase = getServiceClient();
    const { error } = await supabase
      .from("messages")
      .update({ status: "FAILED" })
      .eq("id", messageId)
      .neq("status", "COMPLETE");
    if (error) {
      logger.warn({ err: error, messageId }, "failed_to_mark_message_failed");
    }
  } catch (err) {
    logger.warn({ err, messageId }, "failed_to_mark_message_failed");
  }
}
