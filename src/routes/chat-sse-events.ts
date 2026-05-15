import type { ChatStreamEnvelope } from "../chat-agent/streaming";
import type { ProteinStructure } from "../types/core";

type SendChatSseEvent = (
  event: ChatStreamEnvelope["event"],
  data: ChatStreamEnvelope["data"]
) => void;

export function createChatSseEventHandlers(params: {
  conversationId: string;
  messageId: string;
  send: SendChatSseEvent;
  userId: string;
}) {
  const { conversationId, messageId, send, userId } = params;
  let turnIndex = 0;
  let streamStarted = false;

  return {
    emitStreamEvent(envelope: ChatStreamEnvelope) {
      send(envelope.event, envelope.data);
    },
    onStreamPause() {
      if (!streamStarted) return;
      send("stream_end", {
        reason: "paused",
        turnIndex,
      });
      streamStarted = false;
    },
    onTextDelta(delta: string) {
      if (!streamStarted) {
        streamStarted = true;
        turnIndex++;
        send("stream_start", { turnIndex });
      }
      send("delta", { text: delta, turnIndex });
    },
    sendFinal(result: { proteinStructures?: ProteinStructure[]; text: string }) {
      if (streamStarted) {
        send("stream_end", {
          reason: "complete",
          turnIndex,
        });
      }
      send("final", {
        conversationId,
        messageId,
        proteinStructures: result.proteinStructures,
        text: result.text,
        userId,
      });
      send("done", { messageId });
    },
    sendRefusalFallback(text: string) {
      if (streamStarted) {
        send("stream_end", {
          reason: "refusal_fallback",
          turnIndex,
        });
        streamStarted = false;
      }
      turnIndex++;
      send("stream_start", { turnIndex });
      send("delta", { text, turnIndex });
      streamStarted = true;
    },
    sendTruncated(error: string) {
      if (streamStarted) {
        send("stream_end", {
          reason: "truncated",
          turnIndex,
        });
      }
      send("error", {
        error,
        reason: "truncated",
      });
    },
  };
}
