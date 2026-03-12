import { Elysia } from "elysia";

import { authResolver } from "../middleware/authResolver";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import type { AuthContext } from "../types/auth";
import {
  ensureUserAndConversation,
  setupConversationData,
} from "../services/chat/setup";
import {
  createMessageRecord,
  updateMessageResponseTime,
} from "../services/chat/tools";
import type { ConversationState, State } from "../types/core";
import logger from "../utils/logger";
import { generateUUID } from "../utils/uuid";

// Agent loop imports
import { runAgentLoop } from "../chat-agent/loop";
import { getToolCount } from "../chat-agent/registry";

// Register tools (side-effect imports)
import "../chat-agent/tools/literature-search";

/**
 * Response type for synchronous chat (in-process mode)
 */
type ChatV2Response = {
  text: string;
  userId?: string; // Included for x402 users to know their identity
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
            message: "This endpoint requires POST method.",
            apiDocumentation: "https://your-docs-url.com/api",
          };
        })
        .post("/api/chat", chatHandler)
        // Manual retry endpoint for failed jobs
        .post("/api/chat/retry/:jobId", chatRetryHandler),
  );

/**
 * Chat Status Handler - Check job status (queue mode only)
 */
async function chatStatusHandler(ctx: any) {
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
      status: "completed",
      result: job.returnvalue,
    };
  }

  if (state === "failed") {
    return {
      status: "failed",
      error: job.failedReason,
      attemptsMade: job.attemptsMade,
    };
  }

  return {
    status: state,
    progress,
    attemptsMade: job.attemptsMade,
  };
}

/**
 * Chat Retry Handler - Manually retry a failed job
 * POST /api/chat/retry/:jobId
 */
async function chatRetryHandler(ctx: any) {
  const { params, set, request } = ctx;
  const { jobId } = params;

  // SECURITY: Get authenticated user
  const auth = (request as any).auth as AuthContext | undefined;

  if (!auth?.userId) {
    set.status = 401;
    return {
      ok: false,
      error: "Authentication required",
      message: "Please provide a valid JWT or API key",
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
      ok: false,
      error: "Job not found",
    };
  }

  // SECURITY: Verify the authenticated user owns this job
  if (job.data.userId !== userId) {
    logger.warn(
      { jobId, requestedBy: userId, ownedBy: job.data.userId },
      "chat_retry_ownership_mismatch"
    );
    set.status = 403;
    return {
      ok: false,
      error: "Access denied: job belongs to another user",
    };
  }

  const state = await job.getState();

  // Only allow retry for failed jobs
  if (state !== "failed") {
    set.status = 400;
    return {
      ok: false,
      error: `Cannot retry job in state '${state}'`,
      message: "Only failed jobs can be manually retried",
    };
  }

  try {
    // Retry the job - moves it back to waiting state
    await job.retry();

    logger.info(
      {
        jobId,
        userId,
        previousAttempts: job.attemptsMade,
      },
      "job_manually_retried"
    );

    return {
      ok: true,
      jobId,
      status: "retrying",
      message: "Job has been queued for retry",
      previousAttempts: job.attemptsMade,
    };
  } catch (error) {
    logger.error({ error, jobId }, "manual_retry_failed");
    set.status = 500;
    return {
      ok: false,
      error: "Failed to retry job",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// Agent loop configuration
// =============================================================================

const AGENT_SYSTEM_PROMPT = `You are a helpful AI research assistant specializing in bioscience and life sciences. You have access to tools that you can use to help answer the user's questions.

Use your judgment on when to use tools:
- For questions that need current research, specific papers, or evidence-based claims, use the literature_search tool.
- For basic definitions, general knowledge, or simple explanations, answer directly from your training data.
- You can search multiple sources (openscholar, biolit, knowledge) by calling the tool multiple times with different source parameters to cross-reference findings.

After getting tool results, synthesize the information into a clear, evidence-based response. Include relevant citations (DOIs, paper titles) from the search results.

If a tool returns an error, explain what went wrong and try a different source or approach.`;

const DEFAULT_AGENT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOOL_CALLS = 10;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Chat Handler - Core logic for POST /api/chat
 * Exported for reuse in x402 routes
 *
 * Supports dual mode:
 * - USE_JOB_QUEUE=false: Executes in-process (existing behavior)
 * - USE_JOB_QUEUE=true: Enqueues to BullMQ and returns immediately
 *
 * Options:
 * - skipStorage: If true, skips all DB operations (stateless mode for x402)
 */
export interface ChatHandlerOptions {
  skipStorage?: boolean;
}

export async function chatHandler(ctx: any, options: ChatHandlerOptions = {}) {
  const { skipStorage = false } = options;
  try {
    const { body, set, request } = ctx;
    const startTime = Date.now();

    const parsedBody = body as any;

    logger.info(
      {
        contentType: request.headers.get("content-type"),
        bodyKeys: body ? Object.keys(body).slice(0, 10) : [],
      },
      "chat_route_entry",
    );

    // Extract message (REQUIRED)
    const message = parsedBody.message;
    if (!message) {
      logger.warn(
        { bodyKeys: Object.keys(parsedBody) },
        "missing_message_field",
      );
      set.status = 400;
      return {
        ok: false,
        error: "Missing required field: message",
      };
    }

    // Get userId from auth context (set by authResolver middleware)
    // Auth context handles: x402 wallet > JWT token > API key > body.userId > anonymous
    const auth = (request as any).auth as AuthContext | undefined;
    let userId = auth?.userId || generateUUID();
    const source = auth?.method === "x402" ? "x402" : "api";
    const isX402User = auth?.method === "x402";

    logger.info(
      {
        userId,
        authMethod: auth?.method || "unknown",
        verified: auth?.verified || false,
        source,
        externalId: auth?.externalId,
      },
      "user_identified_via_auth",
    );

    // For x402 users, ensure wallet user record exists and use the actual user ID
    // Skip when skipStorage is true (stateless mode)
    if (isX402User && auth?.externalId && !skipStorage) {
      const { getOrCreateUserByWallet } = await import("../db/operations");
      const { user, isNew } = await getOrCreateUserByWallet(auth.externalId);

      // Use the actual database user ID (may differ from auth.userId)
      userId = user.id;

      logger.info(
        {
          userId: user.id,
          wallet: auth.externalId,
          isNewUser: isNew,
        },
        "x402_user_record_ensured",
      );
    }

    // Auto-generate conversationId if not provided
    let conversationId = parsedBody.conversationId;
    if (!conversationId) {
      conversationId = generateUUID();
      logger.info({ conversationId, userId }, "auto_generated_conversation_id");
    }

    // Extract files from parsed body
    let files: File[] = [];
    if (parsedBody.files) {
      if (Array.isArray(parsedBody.files)) {
        files = parsedBody.files.filter((f: any) => f instanceof File);
      } else if (parsedBody.files instanceof File) {
        files = [parsedBody.files];
      }
    }

    // Log request details
    logger.info(
      {
        userId,
        conversationId,
        source,
        message,
        messageLength: message.length,
        fileCount: files.length,
        routeType: "chat-v2",
      },
      "chat_request_received",
    );

    // Variables for DB records (or ephemeral equivalents)
    let conversationStateRecord: { id: string; values: any };
    let stateRecord: { id: string };
    let createdMessage: { id: string; conversation_id: string; question: string; source: string };

    if (skipStorage) {
      // Stateless mode: create ephemeral records (no DB operations)
      logger.info({ userId, conversationId }, "skip_storage_mode_using_ephemeral_records");

      const ephemeralMessageId = generateUUID();
      conversationStateRecord = {
        id: generateUUID(),
        values: {
          objective: "",
          keyInsights: [],
          discoveries: [],
          uploadedDatasets: [],
        },
      };
      stateRecord = { id: generateUUID() };
      createdMessage = {
        id: ephemeralMessageId,
        conversation_id: conversationId,
        question: message,
        source,
      };
    } else {
      // Normal mode: full DB operations

      // Ensure user and conversation exist
      // Skip user creation for x402 users (already created by getOrCreateUserByWallet)
      const setupResult = await ensureUserAndConversation(
        userId,
        conversationId,
        {
          skipUserCreation: isX402User,
        },
      );
      if (!setupResult.success) {
        logger.error(
          { error: setupResult.error, userId, conversationId },
          "user_conversation_setup_failed",
        );
        set.status = 500;
        return { ok: false, error: setupResult.error || "Setup failed" };
      }

      logger.info(
        { userId, conversationId },
        "user_conversation_setup_completed",
      );

      // Setup conversation data
      const dataSetup = await setupConversationData(
        conversationId,
        userId,
        source,
        false, // isExternal
        message,
        files.length,
      );
      if (!dataSetup.success) {
        logger.error(
          { error: dataSetup.error, conversationId },
          "conversation_data_setup_failed",
        );
        set.status = 500;
        return { ok: false, error: dataSetup.error || "Data setup failed" };
      }

      conversationStateRecord = dataSetup.data!.conversationStateRecord;
      stateRecord = dataSetup.data!.stateRecord;

      logger.info(
        {
          conversationStateId: conversationStateRecord.id,
          stateId: stateRecord.id,
        },
        "conversation_data_setup_completed",
      );

      // Create message record
      const messageResult = await createMessageRecord({
        conversationId,
        userId,
        message,
        source,
        stateId: stateRecord.id,
        files,
        isExternal: false,
      });
      if (!messageResult.success) {
        logger.error(
          { error: messageResult.error, conversationId },
          "message_creation_failed",
        );
        set.status = 500;
        return {
          ok: false,
          error: messageResult.error || "Message creation failed",
        };
      }

      createdMessage = messageResult.message!;
    }

    logger.info(
      {
        messageId: createdMessage.id,
        conversationId: createdMessage.conversation_id,
        question: createdMessage.question,
      },
      "message_record_created",
    );

    // =========================================================================
    // DUAL MODE: Check if job queue is enabled
    // =========================================================================
    const { isJobQueueEnabled } = await import("../services/queue/connection");

    if (isJobQueueEnabled()) {
      // QUEUE MODE: Enqueue job and return immediately
      // NOTE: The worker (chat.worker.ts) still runs the legacy pipeline,
      // not the new agent loop. This will be migrated once the agent loop is validated.
      logger.info(
        { messageId: createdMessage.id, conversationId },
        "chat_using_queue_mode",
      );

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
          userId,
          conversationId,
          messageId: createdMessage.id,
          message,
          authMethod: auth?.method || "anonymous",
          requestedAt: new Date().toISOString(),
        },
        {
          jobId: createdMessage.id, // Use message ID as job ID for easy lookup
        },
      );

      logger.info(
        {
          jobId: job.id,
          messageId: createdMessage.id,
          conversationId,
        },
        "chat_job_enqueued",
      );

      // Build pollUrl - use full URL for x402 users (external API consumers)
      let pollUrl = `/api/chat/status/${job.id}`;
      if (isX402User) {
        const url = new URL(request.url);
        const forwardedProto = request.headers.get("x-forwarded-proto");
        const protocol = forwardedProto || url.protocol.replace(":", "");
        pollUrl = `${protocol}://${url.host}/api/chat/status/${job.id}`;
      }

      const response: ChatQueuedResponse = {
        jobId: job.id!,
        messageId: createdMessage.id,
        conversationId,
        userId,
        status: "queued",
        pollUrl,
      };

      return new Response(JSON.stringify(response), {
        status: 202, // Accepted
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    // =========================================================================
    // IN-PROCESS MODE: Execute directly (existing behavior)
    // =========================================================================
    logger.info(
      { messageId: createdMessage.id, conversationId },
      "chat_using_in_process_mode",
    );

    // Initialize state
    const state: State = {
      id: stateRecord.id,
      values: {
        messageId: createdMessage.id,
        conversationId,
        userId,
        source: createdMessage.source,
      },
    };

    // Initialize conversation state
    const conversationState: ConversationState = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    logger.info(
      {
        stateId: state.id,
        conversationStateId: conversationState.id,
        existingHypothesis: !!conversationState.values.currentHypothesis,
        keyInsightsCount: conversationState.values.keyInsights?.length || 0,
      },
      "state_initialized",
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
          uploadedDatasets: fileResult.uploadedDatasets,
          errors: fileResult.errors,
          fileCount: files.length,
        },
        "file_upload_agent_completed",
      );
    }

    // =======================================================================
    // Load conversation history for multi-turn context
    // =======================================================================
    const conversationHistoryMessages: Array<{
      role: "user" | "assistant";
      content: string;
    }> = [];

    if (!skipStorage) {
      try {
        const { getMessagesByConversation } = await import("../db/operations");
        // Fetch 4 newest messages, skip current (first), yielding up to 3 prior exchanges
        const recentMessages = await getMessagesByConversation(conversationId, 4);

        if (recentMessages && recentMessages.length > 1) {
          const previous = recentMessages.slice(1).reverse();

          for (const msg of previous) {
            // Only include complete exchanges (both question and response)
            if (msg.question && msg.content) {
              conversationHistoryMessages.push({
                role: "user",
                content: msg.question,
              });
              conversationHistoryMessages.push({
                role: "assistant",
                content:
                  msg.content.length > 1000
                    ? msg.content.substring(0, 1000) + "..."
                    : msg.content,
              });
            }
          }
        }

        logger.info(
          {
            conversationId,
            historyExchanges: conversationHistoryMessages.length / 2,
          },
          "conversation_history_loaded",
        );
      } catch (err) {
        logger.warn(
          { error: err, conversationId },
          "conversation_history_load_failed",
        );
        // Continue without history — don't break the chat
      }
    }

    // =======================================================================
    // Agent loop: LLM decides which tools to call
    // =======================================================================
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logger.error("anthropic_api_key_not_configured");
      set.status = 500;
      return { ok: false, error: "Anthropic API key not configured" };
    }

    const agentConfig: import("../chat-agent/types").AgentLoopConfig = {
      model: process.env.CHAT_AGENT_MODEL || DEFAULT_AGENT_MODEL,
      systemPrompt: AGENT_SYSTEM_PROMPT,
      maxToolCalls:
        parseInt(process.env.CHAT_AGENT_MAX_TOOL_CALLS || "") || DEFAULT_MAX_TOOL_CALLS,
      maxTokens:
        parseInt(process.env.CHAT_AGENT_MAX_TOKENS || "") || DEFAULT_MAX_TOKENS,
      apiKey,
      // Update conversation state in DB after each tool call so frontend
      // can show progress via existing WebSocket/polling
      onToolResult: skipStorage
        ? undefined
        : async (info) => {
            if (!conversationState.id) return;
            try {
              const { updateConversationState } = await import("../db/operations");
              await updateConversationState(conversationState.id, {
                ...conversationState.values,
                agentProgress: {
                  stage: `tool:${info.toolName}`,
                  toolCallCount: info.toolCallCount,
                  lastToolCallId: info.toolCallId,
                  isError: info.result.isError ?? false,
                },
              });

              logger.info(
                {
                  conversationStateId: conversationState.id,
                  toolName: info.toolName,
                  toolCallCount: info.toolCallCount,
                },
                "conversation_state_updated_after_tool_call",
              );
            } catch (err) {
              logger.warn(
                { error: err, toolName: info.toolName },
                "conversation_state_update_failed",
              );
            }
          },
    };

    logger.info(
      {
        messageId: createdMessage.id,
        conversationId,
        toolCount: getToolCount(),
        model: agentConfig.model,
      },
      "agent_loop_starting",
    );

    const agentResult = await runAgentLoop(
      message,
      agentConfig,
      conversationHistoryMessages.length > 0
        ? conversationHistoryMessages
        : undefined,
    );

    const replyText = agentResult.finalText;

    logger.info(
      {
        messageId: createdMessage.id,
        conversationId,
        toolCallCount: agentResult.toolCallCount,
        totalInputTokens: agentResult.totalInputTokens,
        totalOutputTokens: agentResult.totalOutputTokens,
        replyLength: replyText.length,
      },
      "agent_loop_completed",
    );

    const response: ChatV2Response = {
      text: replyText,
      userId, // Include userId so x402 users know their identity
    };

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Save to DB only if not in skipStorage mode
    if (!skipStorage) {
      // Save the response to the message's content field
      const { updateMessage } = await import("../db/operations");
      await updateMessage(createdMessage.id, {
        content: replyText,
      });

      logger.info(
        { messageId: createdMessage.id, contentLength: replyText.length },
        "message_content_saved",
      );

      await updateMessageResponseTime(createdMessage.id, responseTime);

      logger.info(
        {
          messageId: createdMessage.id,
          responseTime,
          responseTimeSec: (responseTime / 1000).toFixed(2),
        },
        "response_time_recorded",
      );
    } else {
      logger.info(
        {
          responseTime,
          responseTimeSec: (responseTime / 1000).toFixed(2),
        },
        "skip_storage_mode_response_not_saved",
      );
    }

    logger.info(
      {
        messageId: createdMessage.id,
        conversationId,
        responseTextLength: response.text?.length || 0,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
        toolCallCount: agentResult.toolCallCount,
      },
      "chat_completed_successfully",
    );

    // Return response
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "identity",
      },
    });
  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
        name: error.name,
      },
      "chat_unhandled_error",
    );

    const { set } = ctx;
    set.status = 500;
    return {
      ok: false,
      error: error.message || "Internal server error",
    };
  }
}
