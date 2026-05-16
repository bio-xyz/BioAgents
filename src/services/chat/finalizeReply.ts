import type {
  ConversationState,
  ConversationStateValues,
  ProteinStructure,
} from "../../types/core";
import logger from "../../utils/logger";
import { withNormalChatProteinStructures } from "../../utils/proteinStructures";

export interface FinalizeChatReplyAgentResult {
  replyText: string;
  hitMaxTokens?: boolean;
  proteinStructures?: ProteinStructure[];
}

export interface FinalizeChatReplyParams {
  messageId: string;
  agentResult: FinalizeChatReplyAgentResult;
  conversationState: ConversationState;
  startTime: number;
}

export interface FinalizeChatReplyDeps {
  markMessageComplete?: (
    id: string,
    update: { content: string; response_time: number }
  ) => Promise<{ updated: boolean }>;
  updateConversationState?: (id: string, values: ConversationStateValues) => Promise<unknown>;
}

export type FinalizeChatReplyOutcome =
  | {
      kind: "completed";
      replyText: string;
      responseTime: number;
      proteinStructures?: ProteinStructure[];
    }
  | { kind: "truncated" }
  | { kind: "empty" }
  | { kind: "save_skipped" };

/**
 * Shared post-`runChatAgent` finalization. Detects truncation/empty replies,
 * persists the reply via `markMessageComplete`, and writes protein structures
 * back to conversation state. The caller (SSE / JSON / queue worker) handles
 * transport-specific outcomes (SSE event vs 500 response vs UnrecoverableError)
 * by switching on the returned outcome kind.
 *
 * The helper deliberately does NOT call `markMessageFailed` — each transport
 * decides whether to flip the row, since the worker uses UnrecoverableError
 * for retries and the SSE/JSON paths flip directly.
 */
export async function finalizeChatReply(
  params: FinalizeChatReplyParams,
  deps: FinalizeChatReplyDeps = {}
): Promise<FinalizeChatReplyOutcome> {
  const { messageId, agentResult, conversationState, startTime } = params;

  if (agentResult.hitMaxTokens) return { kind: "truncated" };
  if (!agentResult.replyText) return { kind: "empty" };

  const markMessageComplete =
    deps.markMessageComplete ?? (await import("./tools")).markMessageComplete;

  const responseTime = Date.now() - startTime;
  const { updated } = await markMessageComplete(messageId, {
    content: agentResult.replyText,
    response_time: responseTime,
  });
  if (!updated) return { kind: "save_skipped" };

  if (agentResult.proteinStructures?.length && conversationState.id) {
    try {
      const updateConversationState =
        deps.updateConversationState ??
        (await import("../../db/operations")).updateConversationState;
      const nextValues = withNormalChatProteinStructures(
        conversationState.values,
        messageId,
        agentResult.proteinStructures
      );
      await updateConversationState(conversationState.id, nextValues);
      conversationState.values = nextValues;
    } catch (err) {
      logger.warn(
        { error: err, messageId },
        "chat_finalize_protein_structures_state_persist_failed"
      );
    }
  }

  return {
    kind: "completed",
    proteinStructures: agentResult.proteinStructures,
    replyText: agentResult.replyText,
    responseTime,
  };
}
