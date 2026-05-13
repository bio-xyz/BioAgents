/**
 * SSE transport for the chat route.
 *
 * Encapsulates the ReadableStream bootstrap (controller setup, heartbeat,
 * encoder, send helper) and the orchestration around the shared
 * runChatAgent executor. The route handler is reduced to:
 *
 *   const stream = buildChatSseStream(params);
 *   return new Response(stream, { headers: STREAM_HEADERS, status: 200 });
 *
 * Notes:
 * - Heartbeat (15s) keeps long silent periods (file-wait, tool execution)
 *   alive through proxies with idle timeouts (nginx 60s, Vercel edge 30s).
 * - Truncation, empty-reply, and post-save errors are surfaced as SSE
 *   error events. The reply is durably saved BEFORE the `final`/`done`
 *   pair is sent — the client may rely on that ordering.
 * - markReplyPersisted is called once the row transitions to COMPLETE.
 *   The caller uses it to skip the post-error markMessageFailed sweep
 *   that would otherwise downgrade a successful reply to FAILED.
 */

import { markMessageComplete, markMessageFailed } from "../services/chat/tools";
import type { ConversationState } from "../types/core";
import type { SourceSelectionId } from "../types/sourceSelection";
import logger from "../utils/logger";
import { withNormalChatProteinStructures } from "../utils/proteinStructures";
import { notifyChatReplyCompleted } from "./chat-notifications";
import { createChatSseEventHandlers } from "./chat-sse-events";

export interface ChatSseStreamParams {
  conversationId: string;
  userId: string;
  message: string;
  sourceSelectionId?: SourceSelectionId;
  createdMessage: { id: string };
  conversationStateRecord: ConversationState;
  files: File[];
  /** Called once the reply has been durably written (status -> COMPLETE). */
  markReplyPersisted: () => void;
}

export function buildChatSseStream(params: ChatSseStreamParams): ReadableStream {
  const {
    conversationId,
    userId,
    message,
    sourceSelectionId,
    createdMessage,
    conversationStateRecord,
    files,
    markReplyPersisted,
  } = params;

  const encoder = new TextEncoder();
  const sseStartTime = Date.now();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream({
    cancel() {
      // Client disconnected. Agent loop keeps running via the awaited
      // runChatAgent call - DB save still happens. send() becomes no-op.
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      logger.info({ messageId: createdMessage.id }, "chat_sse_client_disconnected");
    },
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller closed (client disconnected). Keep running so DB save happens.
        }
      };
      const streamEvents = createChatSseEventHandlers({
        conversationId,
        messageId: createdMessage.id,
        send,
        userId,
      });

      const sendHeartbeat = () => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          // Controller closed
        }
      };

      const startHeartbeat = () => {
        if (heartbeatTimer) return;
        // 15s interval: well under nginx (60s), Vercel edge (30s), CDN limits
        heartbeatTimer = setInterval(sendHeartbeat, 15_000);
      };

      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      const safeClose = () => {
        stopHeartbeat();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Dynamic imports preserve TDZ safety in worker-coupled modules
      // (db/operations eagerly inits the supabase client).
      const { runChatAgent } = await import("../chat-agent/runner");
      const { fileUploadAgent } = await import("../agents/fileUpload");
      const { getPendingFileIds, getFileStatus } = await import("../services/files/status");
      const { getFileProcessQueue } = await import("../services/queue/queues");
      const { waitForPendingFiles } = await import("../services/files/waitForPending");
      const { getConversationState, updateConversationState } = await import("../db/operations");

      let replyPersisted = false;

      try {
        // Send init FIRST so client knows the request was accepted and
        // can render its streaming bubble immediately. Then start heartbeats
        // to keep proxies alive during the silent file-wait period.
        send("init", { conversationId, messageId: createdMessage.id });
        startHeartbeat();

        // Path A: raw files in FormData (legacy direct upload).
        // Process synchronously, mutates conversation state with uploadedDatasets.
        if (files.length > 0) {
          const conversationStateForFiles: ConversationState = {
            id: conversationStateRecord.id,
            values: conversationStateRecord.values,
          };
          await fileUploadAgent({
            conversationState: conversationStateForFiles,
            files,
            userId,
          });
          conversationStateRecord.values = conversationStateForFiles.values;
        }

        // Path B: presigned S3 upload flow. Files uploaded directly to S3
        // BEFORE this request, processed async by file-process worker.
        if (conversationStateRecord.id) {
          const pendingFileIds = await getPendingFileIds(conversationStateRecord.id);
          if (pendingFileIds.length > 0) {
            logger.info(
              { messageId: createdMessage.id, pendingFileIds },
              "chat_sse_waiting_for_file_processing"
            );
            await waitForPendingFiles({
              conversationStateId: conversationStateRecord.id,
              fileProcessQueue: getFileProcessQueue(),
              getFileStatus,
              jobId: createdMessage.id,
              pendingFileIds,
            });

            const fresh = await getConversationState(conversationStateRecord.id);
            if (fresh) {
              conversationStateRecord.values = fresh.values;
            }
          }
        }

        const result = await runChatAgent({
          conversationId,
          loadHistory: true,
          message,
          onStreamEvent: (envelope) => streamEvents.emitStreamEvent(envelope),
          onStreamPause: async () => streamEvents.onStreamPause(),
          onTextDelta: (delta) => streamEvents.onTextDelta(delta),
          onToolResult: async (info) => {
            if (!conversationStateRecord.id) return;
            try {
              await updateConversationState(conversationStateRecord.id, {
                ...conversationStateRecord.values,
                agentProgress: {
                  isError: info.result.isError ?? false,
                  lastToolCallId: info.toolCallId,
                  stage: `tool:${info.toolName}`,
                  toolCallCount: info.toolCallCount,
                },
              });
            } catch (err) {
              logger.warn(
                { error: err, toolName: info.toolName },
                "conversation_state_update_failed"
              );
            }
          },
          sourceSelectionId,
          uploadedDatasets: conversationStateRecord.values.uploadedDatasets,
        });

        // Never persist a partial answer as success.
        if (result.hitMaxTokens) {
          streamEvents.sendTruncated("Response was truncated. Please try a shorter question.");
          await markMessageFailed(createdMessage.id);
          safeClose();
          logger.warn({ messageId: createdMessage.id }, "chat_sse_truncated");
          return;
        }
        if (!result.replyText) {
          send("error", {
            error: "No response generated. Please try again.",
            reason: "empty_reply",
          });
          await markMessageFailed(createdMessage.id);
          safeClose();
          logger.warn({ messageId: createdMessage.id }, "chat_sse_empty_reply");
          return;
        }

        // Persist to DB BEFORE sending done. Contract: "done" means the
        // message is durably saved. The PENDING precondition (see
        // markMessageComplete) means a row already moved to a terminal
        // state surfaces as `error`.
        const responseTime = Date.now() - sseStartTime;
        const { updated } = await markMessageComplete(createdMessage.id, {
          content: result.replyText,
          response_time: responseTime,
        });
        if (!updated) {
          send("error", {
            error: "Response failed to save. Please retry.",
            reason: "agent_error",
          });
          safeClose();
          logger.warn(
            { messageId: createdMessage.id },
            "chat_sse_complete_skipped_row_not_pending"
          );
          return;
        }
        replyPersisted = true;
        markReplyPersisted();

        if (result.proteinStructures?.length && conversationStateRecord.id) {
          try {
            const nextValues = withNormalChatProteinStructures(
              conversationStateRecord.values,
              createdMessage.id,
              result.proteinStructures
            );
            await updateConversationState(conversationStateRecord.id, nextValues);
            conversationStateRecord.values = nextValues;
          } catch (err) {
            logger.warn(
              { error: err, messageId: createdMessage.id },
              "chat_sse_protein_structures_state_persist_failed"
            );
          }
        }

        await notifyChatReplyCompleted({
          conversationId,
          messageId: createdMessage.id,
          proteinStructures: result.proteinStructures,
        });

        // Terminal success signals (only after durable write)
        streamEvents.sendFinal({
          proteinStructures: result.proteinStructures,
          text: result.replyText,
        });
        safeClose();

        logger.info(
          {
            conversationId,
            messageId: createdMessage.id,
            replyLength: result.replyText.length,
            responseTime,
            streaming: true,
            toolCallCount: result.toolCallCount,
            totalInputTokens: result.totalInputTokens,
            totalOutputTokens: result.totalOutputTokens,
          },
          "chat_sse_completed"
        );
      } catch (err) {
        logger.error({ error: err, messageId: createdMessage.id }, "chat_sse_error");
        // Generic client-facing message — raw err.message can leak internal
        // detail (Anthropic SDK errors, DB errors, etc.). Full error is in
        // the logger.error above.
        send("error", {
          error: "Something went wrong while generating the response. Please try again.",
          reason: "agent_error",
        });
        // Only mark FAILED if the reply hasn't already been durably saved.
        // A post-save throw (e.g. logger / safeClose / response-time write)
        // must not downgrade a successful reply to FAILED.
        if (!replyPersisted) {
          await markMessageFailed(createdMessage.id);
        }
        safeClose();
      }
    },
  });
}
