import { createMessage, updateMessage } from "../../db/operations";
import logger from "../../utils/logger";

export interface MessageCreationParams {
  conversationId: string;
  userId: string;
  message: string;
  source: string;
  stateId: string;
  files: File[];
  isExternal: boolean;
}

/**
 * Create message record (for both internal and external agents)
 * External agents need persistent messages to enable multi-turn conversations
 */
export async function createMessageRecord(
  params: MessageCreationParams,
): Promise<{ success: boolean; message?: any; error?: string }> {
  const {
    conversationId,
    userId,
    message,
    source,
    stateId,
    files,
    isExternal,
  } = params;

  try {
    const fileMetadata =
      files.length > 0
        ? files.map((f: any) => ({
            name: f.name,
            size: f.size,
            type: f.type,
          }))
        : undefined;

    const createdMessage = await createMessage({
      conversation_id: conversationId,
      user_id: userId,
      question: message,
      content: "",
      source,
      state_id: stateId,
      files: fileMetadata,
    });

    if (logger) {
      logger.info(
        { messageId: createdMessage.id, isExternal },
        "message_created",
      );
    }

    return { success: true, message: createdMessage };
  } catch (err) {
    if (logger) logger.error({ err, isExternal }, "create_message_failed");
    return { success: false, error: "Failed to create message" };
  }
}

/**
 * Update message response time
 */
export async function updateMessageResponseTime(
  messageId: string,
  responseTime: number,
  isExternal: boolean,
): Promise<void> {
  if (isExternal) {
    return; // Skip for external agents
  }

  try {
    await updateMessage(messageId, {
      response_time: responseTime,
    });
  } catch (err) {
    if (logger) logger.error({ err }, "failed_to_update_response_time");
  }
}
