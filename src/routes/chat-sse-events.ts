import type {
  ChatStreamEnvelope,
  ChatToolCallStreamData,
  ChatToolResultStreamData,
} from "../chat-agent/streaming";
import type { DataArtifact, ProteinStructure } from "../types/core";

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
    emitToolCall(
      data: Omit<ChatToolCallStreamData, "scope" | "status"> & {
        scope?: ChatToolCallStreamData["scope"];
        status?: ChatToolCallStreamData["status"];
      }
    ) {
      send("tool_call", {
        ...data,
        scope: data.scope ?? "orchestrator",
        status: data.status ?? "started",
      });
    },
    emitToolResult(
      data: Omit<ChatToolResultStreamData, "scope"> & {
        scope?: ChatToolResultStreamData["scope"];
      }
    ) {
      send("tool_result", {
        ...data,
        scope: data.scope ?? "orchestrator",
      });
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
    sendFinal(result: {
      artifacts?: DataArtifact[];
      proteinStructures?: ProteinStructure[];
      text: string;
    }) {
      if (streamStarted) {
        send("stream_end", {
          reason: "complete",
          turnIndex,
        });
      }
      send("final", {
        ...(result.artifacts?.length ? { artifacts: result.artifacts } : {}),
        conversationId,
        messageId,
        ...(result.proteinStructures?.length
          ? { proteinStructures: result.proteinStructures }
          : {}),
        text: result.text,
        userId,
      });
      send("done", { messageId });
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
