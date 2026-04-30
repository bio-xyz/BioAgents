import { Elysia } from "elysia";
import type { ChatStreamEnvelope } from "../chat-agent/streaming";
import { authResolver } from "../middleware/authResolver";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import { ensureUserAndConversation, setupConversationData } from "../services/chat/setup";
import { createMessageRecord, updateMessageResponseTime } from "../services/chat/tools";
import type { ConversationState, State } from "../types/core";
import type { ElysiaRouteContext } from "../types/elysia";
import { parseSourceSelectionId } from "../types/sourceSelection";
import { asString, extractFiles, isBodyRecord } from "../utils/bodyParsing";
import logger from "../utils/logger";
import { buildMessageStateValues } from "../utils/messageState";
import { generateUUID } from "../utils/uuid";

const STREAM_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Encoding": "identity",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
};

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
        .post("/api/chat/stream", chatStreamHandler)
        // Manual retry endpoint for failed jobs
        .post("/api/chat/retry/:jobId", chatRetryHandler)
  );

function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createSseErrorStream(error: string, status = 500, code?: string): Response {
  return new Response(encodeSseEvent("error", { code, error }) + encodeSseEvent("done", {}), {
    headers: STREAM_HEADERS,
    status,
  });
}

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
 * Chat Stream Handler - POST /api/chat/stream
 *
 * In-process normal chat over SSE. Queue mode is intentionally not streamed
 * through this route because there is no worker-to-route relay yet.
 */
export async function chatStreamHandler(ctx: ElysiaRouteContext) {
  const { body, request, set } = ctx;
  const startTime = Date.now();
  const parsedBody = isBodyRecord(body) ? body : {};

  logger.info(
    {
      bodyKeys: Object.keys(parsedBody).slice(0, 10),
      contentType: request.headers.get("content-type"),
    },
    "chat_stream_route_entry"
  );

  const message = asString(parsedBody.message);
  if (!message) {
    logger.warn({ bodyKeys: Object.keys(parsedBody) }, "chat_stream_missing_message_field");
    set.status = 400;
    return {
      error: "Missing required field: message",
      ok: false,
    };
  }

  const auth = request.auth;
  const userId = auth?.userId || generateUUID();
  const source = "api";
  const sourceSelectionId = parseSourceSelectionId(asString(parsedBody.sourceSelectionId));
  if (parsedBody.sourceSelectionId !== undefined && !sourceSelectionId) {
    set.status = 400;
    return {
      error: "Invalid sourceSelectionId",
      ok: false,
    };
  }

  const { isJobQueueEnabled } = await import("../services/queue/connection");
  if (isJobQueueEnabled()) {
    return createSseErrorStream(
      "Queued chat streaming is not available yet. Disable USE_JOB_QUEUE or use /api/chat polling.",
      409,
      "QUEUE_STREAMING_UNAVAILABLE"
    );
  }

  let conversationId = asString(parsedBody.conversationId);
  if (!conversationId) {
    conversationId = generateUUID();
    logger.info({ conversationId, userId }, "chat_stream_auto_generated_conversation_id");
  }

  const files: File[] = extractFiles(parsedBody.files);

  logger.info(
    {
      conversationId,
      fileCount: files.length,
      messageLength: message.length,
      routeType: "chat-stream",
      source,
      sourceSelectionId,
      userId,
    },
    "chat_stream_request_received"
  );

  const setupResult = await ensureUserAndConversation(userId, conversationId);
  if (!setupResult.success) {
    logger.error(
      { conversationId, error: setupResult.error, userId },
      "chat_stream_user_conversation_setup_failed"
    );
    set.status = 500;
    return { error: setupResult.error || "Setup failed", ok: false };
  }

  const dataSetup = await setupConversationData(
    conversationId,
    userId,
    source,
    false,
    message,
    files.length
  );
  if (!dataSetup.success) {
    logger.error(
      { conversationId, error: dataSetup.error },
      "chat_stream_conversation_data_setup_failed"
    );
    set.status = 500;
    return { error: dataSetup.error || "Data setup failed", ok: false };
  }

  const conversationStateRecord = dataSetup.data!.conversationStateRecord;
  const stateRecord = dataSetup.data!.stateRecord;

  const messageResult = await createMessageRecord({
    conversationId,
    files,
    isExternal: false,
    message,
    source,
    sourceSelectionId,
    stateId: stateRecord.id,
    userId,
  });
  if (!messageResult.success) {
    logger.error(
      { conversationId, error: messageResult.error },
      "chat_stream_message_creation_failed"
    );
    set.status = 500;
    return {
      error: messageResult.error || "Message creation failed",
      ok: false,
    };
  }

  const createdMessage = messageResult.message!;
  const state: State = {
    id: stateRecord.id,
    values: buildMessageStateValues({
      baseValues: stateRecord.values,
      message: createdMessage,
    }),
  };
  const conversationState: ConversationState = {
    id: conversationStateRecord.id,
    values: conversationStateRecord.values,
  };

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const abortFromRequest = () => abortController.abort(request.signal.reason);
  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener("abort", abortFromRequest, { once: true });
  }

  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel(reason) {
      closed = true;
      abortController.abort(reason);
      request.signal.removeEventListener("abort", abortFromRequest);
    },
    async start(controller) {
      const emit = async (envelope: ChatStreamEnvelope) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(envelope.event, envelope.data)));
        } catch (error) {
          closed = true;
          abortController.abort(error);
        }
      };

      try {
        await emit({
          data: {
            conversationId,
            messageId: createdMessage.id,
          },
          event: "chat_started",
        });

        if (files.length > 0) {
          const { fileUploadAgent } = await import("../agents/fileUpload");
          logger.info({ fileCount: files.length }, "chat_stream_processing_file_uploads");
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
            "chat_stream_file_upload_agent_completed"
          );
        }

        abortController.signal.throwIfAborted();

        const { runChatAgent } = await import("../chat-agent/runner");
        const agentResult = await runChatAgent({
          conversationId,
          loadHistory: true,
          message,
          onStreamEvent: emit,
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
                "chat_stream_conversation_state_updated_after_tool_call"
              );
            } catch (err) {
              logger.warn(
                { error: err, toolName: info.toolName },
                "chat_stream_conversation_state_update_failed"
              );
            }
          },
          signal: abortController.signal,
          sourceSelectionId: state.values.sourceSelectionId,
          uploadedDatasets: conversationState.values.uploadedDatasets,
        });

        const replyText = agentResult.replyText;
        if (!replyText || agentResult.hitMaxTokens) {
          logger.error({ messageId: createdMessage.id }, "chat_stream_agent_loop_empty_max_tokens");
          await emit({
            data: {
              code: "TRUNCATED_RESPONSE",
              error: "Response was truncated. Please try a shorter question.",
            },
            event: "error",
          });
          return;
        }

        const responseTime = Date.now() - startTime;
        const { updateMessage } = await import("../db/operations");
        await updateMessage(createdMessage.id, {
          content: replyText,
        });
        await updateMessageResponseTime(createdMessage.id, responseTime);

        logger.info(
          {
            conversationId,
            messageId: createdMessage.id,
            replyLength: replyText.length,
            responseTime,
            toolCallCount: agentResult.toolCallCount,
          },
          "chat_stream_completed_successfully"
        );

        await emit({
          data: {
            conversationId,
            messageId: createdMessage.id,
            text: replyText,
            userId,
          },
          event: "final",
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          logger.info({ messageId: createdMessage.id }, "chat_stream_aborted");
          return;
        }

        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(
          {
            error: err.message,
            messageId: createdMessage.id,
            name: err.name,
            stack: err.stack,
          },
          "chat_stream_unhandled_error"
        );
        await emit({
          data: {
            error: err.message || "Internal server error",
          },
          event: "error",
        });
      } finally {
        request.signal.removeEventListener("abort", abortFromRequest);
        await emit({ data: {}, event: "done" });
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: STREAM_HEADERS,
    status: 200,
  });
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
    const sourceSelectionId = parseSourceSelectionId(asString(parsedBody.sourceSelectionId));
    if (parsedBody.sourceSelectionId !== undefined && !sourceSelectionId) {
      set.status = 400;
      return {
        error: "Invalid sourceSelectionId",
        ok: false,
      };
    }

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
        sourceSelectionId,
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
      sourceSelectionId,
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
      values: buildMessageStateValues({
        baseValues: stateRecord.values,
        message: createdMessage,
      }),
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
      sourceSelectionId: state.values.sourceSelectionId,
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
