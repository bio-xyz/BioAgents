import { Elysia } from "elysia";

import { authResolver } from "../middleware/authResolver";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import { ensureUserAndConversation, setupConversationData } from "../services/chat/setup";
import { createMessageRecord, updateMessageResponseTime } from "../services/chat/tools";
import type { ConversationState, State } from "../types/core";
import type { ElysiaRouteContext } from "../types/elysia";
import { asString, extractFiles, isBodyRecord } from "../utils/bodyParsing";
import logger from "../utils/logger";
import { generateUUID } from "../utils/uuid";

/**
 * Response type for synchronous chat (in-process mode)
 */
type ChatV2Response = {
  text: string;
  userId?: string;
};

/**
 * Response type for async chat (queue mode)
 */
type ChatQueuedResponse = {
  jobId: string;
  messageId: string;
  conversationId: string;
  userId: string;
  status: "queued";
  pollUrl: string;
};

/**
 * Chat Route - Agent-based architecture
 * Uses guard pattern to ensure auth runs for all routes
 *
 * Supports dual mode:
 * - USE_JOB_QUEUE=false (default): In-process execution, returns result directly
 * - USE_JOB_QUEUE=true: Enqueues job to BullMQ, returns job ID for polling
 */
export const chatRoute = new Elysia()
  // Job status endpoint - outside auth guard since job ID is unguessable UUID
  // This allows polling without auth, useful for webhooks and external monitoring
  .get("/api/chat/status/:jobId", chatStatusHandler)
  .guard(
    {
      beforeHandle: [
        authResolver({
          required: true, // Always require auth - no environment-based bypass
        }),
        rateLimitMiddleware("chat"),
      ],
    },
    (app) =>
      app
        .get("/api/chat", async () => {
          return {
            apiDocumentation: "https://your-docs-url.com/api",
            message: "This endpoint requires POST method.",
          };
        })
        .post("/api/chat", chatHandler)
        // Manual retry endpoint for failed jobs
        .post("/api/chat/retry/:jobId", chatRetryHandler)
  );

/**
 * Chat Status Handler - Check job status (queue mode only)
 */
async function chatStatusHandler(ctx: ElysiaRouteContext<{ jobId: string }>) {
  const { params, set } = ctx;
  const { jobId } = params;

  const { isJobQueueEnabled } = await import("../services/queue/connection");

  if (!isJobQueueEnabled()) {
    set.status = 404;
    return {
      error: "Job queue not enabled",
      message: "Status endpoint only available when USE_JOB_QUEUE=true",
    };
  }

  const { getChatQueue } = await import("../services/queue/queues");
  const chatQueue = getChatQueue();

  const job = await chatQueue.getJob(jobId);

  if (!job) {
    set.status = 404;
    return { status: "not_found" };
  }

  const state = await job.getState();
  const progress = job.progress as { stage?: string; percent?: number };

  if (state === "completed") {
    return {
      result: job.returnvalue,
      status: "completed",
    };
  }

  if (state === "failed") {
    return {
      attemptsMade: job.attemptsMade,
      error: job.failedReason,
      status: "failed",
    };
  }

  return {
    attemptsMade: job.attemptsMade,
    progress,
    status: state,
  };
}

/**
 * Chat Retry Handler - Manually retry a failed job
 * POST /api/chat/retry/:jobId
 */
async function chatRetryHandler(ctx: ElysiaRouteContext<{ jobId: string }>) {
  const { params, set, request } = ctx;
  const { jobId } = params;

  // SECURITY: Get authenticated user
  const auth = request.auth;

  if (!auth?.userId) {
    set.status = 401;
    return {
      error: "Authentication required",
      message: "Please provide a valid JWT or API key",
      ok: false,
    };
  }

  const userId = auth.userId;

  const { isJobQueueEnabled } = await import("../services/queue/connection");

  if (!isJobQueueEnabled()) {
    set.status = 404;
    return {
      error: "Job queue not enabled",
      message: "Retry endpoint only available when USE_JOB_QUEUE=true",
    };
  }

  const { getChatQueue } = await import("../services/queue/queues");
  const chatQueue = getChatQueue();

  const job = await chatQueue.getJob(jobId);

  if (!job) {
    set.status = 404;
    return {
      error: "Job not found",
      ok: false,
    };
  }

  // SECURITY: Verify the authenticated user owns this job
  if (job.data.userId !== userId) {
    logger.warn(
      { jobId, ownedBy: job.data.userId, requestedBy: userId },
      "chat_retry_ownership_mismatch"
    );
    set.status = 403;
    return {
      error: "Access denied: job belongs to another user",
      ok: false,
    };
  }

  const state = await job.getState();

  // Only allow retry for failed jobs
  if (state !== "failed") {
    set.status = 400;
    return {
      error: `Cannot retry job in state '${state}'`,
      message: "Only failed jobs can be manually retried",
      ok: false,
    };
  }

  try {
    // Retry the job - moves it back to waiting state
    await job.retry();

    logger.info(
      {
        jobId,
        previousAttempts: job.attemptsMade,
        userId,
      },
      "job_manually_retried"
    );

    return {
      jobId,
      message: "Job has been queued for retry",
      ok: true,
      previousAttempts: job.attemptsMade,
      status: "retrying",
    };
  } catch (error) {
    logger.error({ error, jobId }, "manual_retry_failed");
    set.status = 500;
    return {
      error: "Failed to retry job",
      message: error instanceof Error ? error.message : "Unknown error",
      ok: false,
    };
  }
}

/**
 * Chat Handler - Core logic for POST /api/chat
 *
 * Supports dual mode:
 * - USE_JOB_QUEUE=false: Executes in-process (existing behavior)
 * - USE_JOB_QUEUE=true: Enqueues to BullMQ and returns immediately
 */
export async function chatHandler(ctx: ElysiaRouteContext) {
  try {
    const { body, set, request } = ctx;
    const startTime = Date.now();

    const parsedBody = isBodyRecord(body) ? body : {};

    logger.info(
      {
        bodyKeys: Object.keys(parsedBody).slice(0, 10),
        contentType: request.headers.get("content-type"),
      },
      "chat_route_entry"
    );

    // Extract message (REQUIRED)
    const message = asString(parsedBody.message);
    if (!message) {
      logger.warn({ bodyKeys: Object.keys(parsedBody) }, "missing_message_field");
      set.status = 400;
      return {
        error: "Missing required field: message",
        ok: false,
      };
    }

    // Get userId from auth context (set by authResolver middleware)
    const auth = request.auth;
    const userId = auth?.userId || generateUUID();
    const source = "api";

    logger.info(
      {
        authMethod: auth?.method || "unknown",
        source,
        userId,
        verified: auth?.verified || false,
      },
      "user_identified_via_auth"
    );

    // Auto-generate conversationId if not provided
    let conversationId = asString(parsedBody.conversationId);
    if (!conversationId) {
      conversationId = generateUUID();
      logger.info({ conversationId, userId }, "auto_generated_conversation_id");
    }

    // Extract files from parsed body
    const files: File[] = extractFiles(parsedBody.files);

    // Log request details
    logger.info(
      {
        conversationId,
        fileCount: files.length,
        message,
        messageLength: message.length,
        routeType: "chat-v2",
        source,
        userId,
      },
      "chat_request_received"
    );

    // Ensure user and conversation exist
    const setupResult = await ensureUserAndConversation(userId, conversationId);
    if (!setupResult.success) {
      logger.error(
        { conversationId, error: setupResult.error, userId },
        "user_conversation_setup_failed"
      );
      set.status = 500;
      return { error: setupResult.error || "Setup failed", ok: false };
    }

    logger.info({ conversationId, userId }, "user_conversation_setup_completed");

    // Setup conversation data
    const dataSetup = await setupConversationData(
      conversationId,
      userId,
      source,
      false, // isExternal
      message,
      files.length
    );
    if (!dataSetup.success) {
      logger.error({ conversationId, error: dataSetup.error }, "conversation_data_setup_failed");
      set.status = 500;
      return { error: dataSetup.error || "Data setup failed", ok: false };
    }

    const conversationStateRecord = dataSetup.data!.conversationStateRecord;
    const stateRecord = dataSetup.data!.stateRecord;

    logger.info(
      {
        conversationStateId: conversationStateRecord.id,
        stateId: stateRecord.id,
      },
      "conversation_data_setup_completed"
    );

    // Create message record
    const messageResult = await createMessageRecord({
      conversationId,
      files,
      isExternal: false,
      message,
      source,
      stateId: stateRecord.id,
      userId,
    });
    if (!messageResult.success) {
      logger.error({ conversationId, error: messageResult.error }, "message_creation_failed");
      set.status = 500;
      return {
        error: messageResult.error || "Message creation failed",
        ok: false,
      };
    }

    const createdMessage = messageResult.message!;

    logger.info(
      {
        conversationId: createdMessage.conversation_id,
        messageId: createdMessage.id,
        question: createdMessage.question,
      },
      "message_record_created"
    );

    // =========================================================================
    // SSE STREAMING PATH (in-process, bypasses queue mode)
    // Triggered when client sends Accept: text/event-stream header.
    // Non-SSE requests fall through to the existing queue/JSON paths below.
    // =========================================================================
    const acceptsSSE = request.headers
      .get("accept")
      ?.includes("text/event-stream");

    if (acceptsSSE) {
      logger.info(
        { messageId: createdMessage.id, conversationId },
        "chat_using_sse_mode",
      );

      // Import SSE dependencies at function scope (dynamic for TDZ safety)
      const { runChatAgent } = await import("../chat-agent/runner");
      const { fileUploadAgent } = await import("../agents/fileUpload");
      const { getPendingFileIds, getFileStatus } = await import(
        "../services/files/status"
      );
      const { getFileProcessQueue } = await import(
        "../services/queue/queues"
      );
      const {
        getConversationState,
        updateMessage,
        updateConversationState,
      } = await import("../db/operations");

      const encoder = new TextEncoder();
      const sseStartTime = Date.now();
      let turnIndex = 0;
      let streamStarted = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream({
        async start(controller) {
          // Helper: safe enqueue (swallows errors if client disconnected)
          const send = (event: string, data: unknown) => {
            try {
              controller.enqueue(
                encoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            } catch {
              // Controller closed (client disconnected). Keep running so DB save happens.
            }
          };

          // SSE comment frame - ignored by the client parser but keeps the
          // connection alive through proxies (nginx default idle timeout 60s,
          // Vercel edge 30s, etc.). Critical for long silent periods:
          // tool execution (literature_search 30s timeout), file processing
          // (up to 2 min) can easily exceed proxy idle limits.
          const sendHeartbeat = () => {
            try {
              controller.enqueue(
                encoder.encode(`: heartbeat ${Date.now()}\n\n`),
              );
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

          try {
            // Send init FIRST so client knows the request was accepted and
            // can render its streaming bubble immediately. Then start heartbeats
            // to keep proxies alive during the silent file-wait period.
            send("init", {
              messageId: createdMessage.id,
              conversationId,
            });
            startHeartbeat();

            // === File handling: TWO paths, handle both ===
            //
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
              conversationStateRecord.values =
                conversationStateForFiles.values;
            }

            // Path B: presigned S3 upload flow (usePresignedUpload.ts).
            // Files uploaded directly to S3 BEFORE this request, processed
            // async by file-process worker. Port the exact wait logic from
            // chat.worker.ts:95-174 so SSE doesn't race with file processing.
            // Without this, the agent runs before uploaded datasets are ready.
            if (conversationStateRecord.id) {
              const pendingFileIds = await getPendingFileIds(
                conversationStateRecord.id,
              );
              if (pendingFileIds.length > 0) {
                logger.info(
                  { messageId: createdMessage.id, pendingFileIds },
                  "chat_sse_waiting_for_file_processing",
                );
                // CRITICAL: getFileProcessQueue() returns null when
                // USE_JOB_QUEUE=false (queues.ts:120). Must null-guard before
                // calling .getJob() or we null-deref in in-process mode.
                const fileProcessQueue = getFileProcessQueue();
                const maxWaitMs = 120_000; // 2 min cap, matches worker
                const pollIntervalMs = 500;
                const startWait = Date.now();

                for (const fileId of pendingFileIds) {
                  while (Date.now() - startWait < maxWaitMs) {
                    // Prefer file status check (always available, DB-backed).
                    // Queue job state only consulted when the queue exists.
                    const fileStatus = await getFileStatus(fileId);
                    if (fileStatus?.status === "ready") break;
                    if (fileStatus?.status === "error") {
                      logger.warn(
                        { messageId: createdMessage.id, fileId },
                        "chat_sse_file_failed_continuing",
                      );
                      break;
                    }

                    // Secondary signal from BullMQ job state when queue exists
                    if (fileProcessQueue) {
                      const fileJob = await fileProcessQueue.getJob(fileId);
                      const fileJobState = fileJob
                        ? await fileJob.getState()
                        : null;
                      if (fileJobState === "completed" || !fileJob) break;
                      if (fileJobState === "failed") {
                        logger.warn(
                          { messageId: createdMessage.id, fileId },
                          "chat_sse_file_job_failed_continuing",
                        );
                        break;
                      }
                    }

                    await new Promise((r) =>
                      setTimeout(r, pollIntervalMs),
                    );
                  }
                }

                // Refresh conversation state to pick up uploadedDatasets
                const fresh = await getConversationState(
                  conversationStateRecord.id,
                );
                if (fresh) {
                  conversationStateRecord.values = fresh.values;
                }
              }
            }

            const result = await runChatAgent({
              conversationId,
              message,
              uploadedDatasets:
                conversationStateRecord.values.uploadedDatasets,
              loadHistory: true,
              onTextDelta: (delta) => {
                if (!streamStarted) {
                  streamStarted = true;
                  turnIndex++;
                  send("stream_start", { turnIndex });
                }
                send("delta", { text: delta, turnIndex });
              },
              onStreamPause: async () => {
                // Called by loop.ts AFTER finalMessage, BEFORE tool execution
                if (streamStarted) {
                  send("stream_end", {
                    isFinal: false,
                    turnIndex,
                    reason: "paused",
                  });
                  streamStarted = false;
                }
              },
              onToolResult: async (info) => {
                // Mirror existing in-process path: update conversation state
                if (!conversationStateRecord.id) return;
                try {
                  await updateConversationState(conversationStateRecord.id, {
                    ...conversationStateRecord.values,
                    agentProgress: {
                      stage: `tool:${info.toolName}`,
                      toolCallCount: info.toolCallCount,
                      lastToolCallId: info.toolCallId,
                      isError: info.result.isError ?? false,
                    },
                  });
                } catch (err) {
                  logger.warn(
                    { error: err, toolName: info.toolName },
                    "conversation_state_update_failed",
                  );
                }
              },
            });

            // === Truncation guard ===
            // Matches existing non-SSE path at chat.ts:568.
            // Never persist a partial answer as success.
            if (result.hitMaxTokens) {
              if (streamStarted) {
                send("stream_end", {
                  isFinal: false,
                  turnIndex,
                  reason: "truncated",
                });
              }
              send("error", {
                reason: "truncated",
                message:
                  "Response was truncated. Please try a shorter question.",
              });
              safeClose();
              logger.warn(
                { messageId: createdMessage.id },
                "chat_sse_truncated",
              );
              return;
            }
            if (!result.replyText) {
              send("error", {
                reason: "empty_reply",
                message: "No response generated. Please try again.",
              });
              safeClose();
              logger.warn(
                { messageId: createdMessage.id },
                "chat_sse_empty_reply",
              );
              return;
            }

            // === Persist to DB BEFORE sending done ===
            // Contract: "done" means the message is durably saved. If DB save
            // fails, we send "error" instead - client keeps user message visible.
            const responseTime = Date.now() - sseStartTime;
            await updateMessage(createdMessage.id, {
              content: result.replyText,
            });
            await updateMessageResponseTime(createdMessage.id, responseTime);

            // === Terminal success signals (only after durable write) ===
            if (streamStarted) {
              send("stream_end", {
                isFinal: true,
                turnIndex,
                reason: "complete",
              });
            }
            send("done", { messageId: createdMessage.id });
            safeClose();

            logger.info(
              {
                messageId: createdMessage.id,
                conversationId,
                toolCallCount: result.toolCallCount,
                totalInputTokens: result.totalInputTokens,
                totalOutputTokens: result.totalOutputTokens,
                responseTime,
                replyLength: result.replyText.length,
                streaming: true,
              },
              "chat_sse_completed",
            );
          } catch (err) {
            logger.error(
              { error: err, messageId: createdMessage.id },
              "chat_sse_error",
            );
            // Generic client-facing message -- raw err.message can leak
            // internal detail (Anthropic SDK errors, DB errors, etc.). Full
            // error is already captured in the logger.error above.
            send("error", {
              reason: "agent_error",
              message: "Something went wrong while generating the response. Please try again.",
            });
            safeClose();
          }
        },
        cancel() {
          // Client disconnected. Agent loop keeps running via the awaited
          // runChatAgent call - DB save still happens. send() becomes no-op.
          // Clear the heartbeat timer to prevent leak.
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          logger.info(
            { messageId: createdMessage.id },
            "chat_sse_client_disconnected",
          );
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          // Disable nginx buffering - critical for real-time streaming
          "X-Accel-Buffering": "no",
        },
      });
    }

    // =========================================================================
    // DUAL MODE: Check if job queue is enabled
    // =========================================================================
    const { isJobQueueEnabled } = await import("../services/queue/connection");

    if (isJobQueueEnabled()) {
      // QUEUE MODE: Enqueue job and return immediately
      // Worker runs agent loop (CHAT_AGENT_QUEUE_ENABLED=true) or legacy pipeline (default).
      logger.info({ conversationId, messageId: createdMessage.id }, "chat_using_queue_mode");

      // Process files synchronously before enqueuing (files can't be serialized)
      if (files.length > 0) {
        const conversationState: ConversationState = {
          id: conversationStateRecord.id,
          values: conversationStateRecord.values,
        };

        const { fileUploadAgent } = await import("../agents/fileUpload");

        logger.info({ fileCount: files.length }, "processing_file_uploads_before_queue");

        await fileUploadAgent({
          conversationState,
          files,
          userId,
        });
      }

      // Enqueue the job
      const { getChatQueue } = await import("../services/queue/queues");
      const chatQueue = getChatQueue();

      const job = await chatQueue.add(
        `chat-${createdMessage.id}`,
        {
          authMethod: auth?.method || "anonymous",
          conversationId,
          message,
          messageId: createdMessage.id,
          requestedAt: new Date().toISOString(),
          userId,
        },
        {
          jobId: createdMessage.id, // Use message ID as job ID for easy lookup
        }
      );

      logger.info(
        {
          conversationId,
          jobId: job.id,
          messageId: createdMessage.id,
        },
        "chat_job_enqueued"
      );

      const pollUrl = `/api/chat/status/${job.id}`;

      const response: ChatQueuedResponse = {
        conversationId,
        jobId: job.id!,
        messageId: createdMessage.id,
        pollUrl,
        status: "queued",
        userId,
      };

      return new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        status: 202, // Accepted
      });
    }

    // =========================================================================
    // IN-PROCESS MODE: Execute directly (existing behavior)
    // =========================================================================
    logger.info({ conversationId, messageId: createdMessage.id }, "chat_using_in_process_mode");

    // Initialize state
    const state: State = {
      id: stateRecord.id,
      values: {
        conversationId,
        messageId: createdMessage.id,
        source: createdMessage.source,
        userId,
      },
    };

    // Initialize conversation state
    const conversationState: ConversationState = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    logger.info(
      {
        conversationStateId: conversationState.id,
        existingHypothesis: !!conversationState.values.currentHypothesis,
        keyInsightsCount: conversationState.values.keyInsights?.length || 0,
        stateId: state.id,
      },
      "state_initialized"
    );

    // Step 1: Process files if any
    if (files.length > 0) {
      const { fileUploadAgent } = await import("../agents/fileUpload");

      logger.info({ fileCount: files.length }, "processing_file_uploads");

      const fileResult = await fileUploadAgent({
        conversationState,
        files,
        userId: state.values.userId || "unknown",
      });

      logger.info(
        {
          errors: fileResult.errors,
          fileCount: files.length,
          uploadedDatasets: fileResult.uploadedDatasets,
        },
        "file_upload_agent_completed"
      );
    }

    // =======================================================================
    // Agent loop: LLM decides which tools to call
    // =======================================================================
    const { runChatAgent } = await import("../chat-agent/runner");

    const agentResult = await runChatAgent({
      conversationId,
      loadHistory: true,
      message,
      onToolResult: async (info) => {
        if (!conversationState.id) return;
        try {
          const { updateConversationState } = await import("../db/operations");
          await updateConversationState(conversationState.id, {
            ...conversationState.values,
            agentProgress: {
              isError: info.result.isError ?? false,
              lastToolCallId: info.toolCallId,
              stage: `tool:${info.toolName}`,
              toolCallCount: info.toolCallCount,
            },
          });

          logger.info(
            {
              conversationStateId: conversationState.id,
              toolCallCount: info.toolCallCount,
              toolName: info.toolName,
            },
            "conversation_state_updated_after_tool_call"
          );
        } catch (err) {
          logger.warn({ error: err, toolName: info.toolName }, "conversation_state_update_failed");
        }
      },
      uploadedDatasets: conversationState.values.uploadedDatasets,
    });

    const replyText = agentResult.replyText;

    // Handle empty response from max_tokens truncation
    if (!replyText || agentResult.hitMaxTokens) {
      logger.error({ messageId: createdMessage.id }, "agent_loop_empty_max_tokens");
      set.status = 500;
      return {
        error: "Response was truncated. Please try a shorter question.",
        ok: false,
      };
    }

    logger.info(
      {
        conversationId,
        messageId: createdMessage.id,
        replyLength: replyText.length,
        toolCallCount: agentResult.toolCallCount,
        totalInputTokens: agentResult.totalInputTokens,
        totalOutputTokens: agentResult.totalOutputTokens,
      },
      "agent_loop_completed"
    );

    const response: ChatV2Response = {
      text: replyText,
      userId,
    };

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Save the response to the message's content field
    const { updateMessage } = await import("../db/operations");
    await updateMessage(createdMessage.id, {
      content: replyText,
    });

    logger.info(
      { contentLength: replyText.length, messageId: createdMessage.id },
      "message_content_saved"
    );

    await updateMessageResponseTime(createdMessage.id, responseTime);

    logger.info(
      {
        messageId: createdMessage.id,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
      },
      "response_time_recorded"
    );

    logger.info(
      {
        conversationId,
        messageId: createdMessage.id,
        responseTextLength: response.text?.length || 0,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
        toolCallCount: agentResult.toolCallCount,
      },
      "chat_completed_successfully"
    );

    // Return response
    return new Response(JSON.stringify(response), {
      headers: {
        "Content-Encoding": "identity",
        "Content-Type": "application/json; charset=utf-8",
      },
      status: 200,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        error: err.message,
        name: err.name,
        stack: err.stack,
      },
      "chat_unhandled_error"
    );

    const { set } = ctx;
    set.status = 500;
    return {
      error: err.message || "Internal server error",
      ok: false,
    };
  }
}
