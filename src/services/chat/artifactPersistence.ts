import type { ConversationState, ConversationStateValues, DataArtifact } from "../../types/core";
import { withNormalChatArtifacts } from "../../utils/artifacts";
import logger from "../../utils/logger";

type ConversationStateReader = (id: string) => Promise<{ values: ConversationStateValues } | null>;

type ConversationStateWriter = (id: string, values: ConversationStateValues) => Promise<unknown>;

async function withConversationStateLock<T>(
  conversationStateId: string,
  run: () => Promise<T>
): Promise<T> {
  const { isJobQueueEnabled } = await import("../queue/connection");
  if (!isJobQueueEnabled()) {
    return run();
  }

  const { getBullMQConnection } = await import("../queue/connection");
  const redis = getBullMQConnection();
  const lockKey = `lock:conversation_state:${conversationStateId}`;
  const lockTTL = 30;
  const maxRetries = 10;
  const retryDelay = 100;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const acquired = await redis.set(lockKey, "1", "EX", lockTTL, "NX");
    if (acquired) {
      try {
        return await run();
      } finally {
        await redis.del(lockKey);
      }
    }

    logger.debug({ attempt, conversationStateId }, "normal_chat_artifacts_waiting_for_lock");
    await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
  }

  throw new Error(
    `Failed to acquire lock for conversation state ${conversationStateId} after ${maxRetries} attempts`
  );
}

export async function persistNormalChatArtifacts(params: {
  artifacts?: DataArtifact[];
  conversationState: ConversationState;
  getConversationState?: ConversationStateReader;
  messageId: string;
  updateConversationState?: ConversationStateWriter;
}): Promise<void> {
  if (!params.artifacts?.length || !params.conversationState.id) return;

  const conversationStateId = params.conversationState.id;
  const dbOperations =
    params.getConversationState && params.updateConversationState
      ? undefined
      : await import("../../db/operations");
  const getConversationState = params.getConversationState ?? dbOperations!.getConversationState;
  const updateConversationState =
    params.updateConversationState ?? dbOperations!.updateConversationState;

  await withConversationStateLock(conversationStateId, async () => {
    const freshState = await getConversationState(conversationStateId);
    const baseValues = freshState?.values ?? params.conversationState.values;
    const nextValues = withNormalChatArtifacts(baseValues, params.messageId, params.artifacts);

    await updateConversationState(conversationStateId, nextValues);
    params.conversationState.values = nextValues;
  });
}
