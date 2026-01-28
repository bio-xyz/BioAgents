import { Elysia } from "elysia";
import { LLM } from "../llm/provider";
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
import type { ConversationState, PlanTask, State } from "../types/core";
import logger from "../utils/logger";
import { generateUUID } from "../utils/uuid";

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

/**
 * Check if the question requires a hypothesis using LLM
 */
async function requiresHypothesis(
  question: string,
  literatureResults: string,
  messageId?: string, // For token usage tracking
): Promise<boolean> {
  const PLANNING_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "google";
  const apiKey = process.env[`${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!apiKey) {
    logger.warn("LLM API key not configured, defaulting to no hypothesis");
    return false;
  }

  logger.info(
    {
      questionLength: question.length,
      literatureResultsLength: literatureResults.length,
      provider: PLANNING_LLM_PROVIDER,
    },
    "checking_hypothesis_requirement",
  );

  const llmProvider = new LLM({
    // @ts-ignore
    name: PLANNING_LLM_PROVIDER,
    apiKey,
  });

  const prompt = `Analyze this user question and literature results to determine if a research hypothesis is needed.

User Question: ${question}

Literature Results Preview: ${literatureResults.slice(0, 1000)}

A hypothesis IS needed if:
- The question asks about mechanisms, predictions, or causal relationships
- The question requires synthesizing multiple sources into a novel insight
- The question is exploratory and needs a testable proposition

A hypothesis IS NOT needed if:
- The question asks for factual information or definitions
- The question can be answered directly from literature
- The question is a simple lookup or clarification

Respond with ONLY "YES" if a hypothesis is needed, or "NO" if it's not needed.`;

  try {
    const response = await llmProvider.createChatCompletion({
      model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-flash",
      messages: [
        {
          role: "user" as const,
          content: prompt,
        },
      ],
      maxTokens: 10,
      messageId,
      usageType: "chat",
    });

    const answer = response.content.trim().toUpperCase();
    logger.info(
      {
        answer,
        questionLength: question.length,
        decision:
          answer === "YES" ? "hypothesis_required" : "hypothesis_not_required",
      },
      "hypothesis_requirement_check_completed",
    );

    return answer === "YES";
  } catch (err) {
    logger.error({ err }, "hypothesis_check_failed");
    return false; // Default to no hypothesis on error
  }
}

/**
 * Chat Handler - Core logic for POST /api/chat
 * Exported for reuse in x402 routes
 *
 * Supports dual mode:
 * - USE_JOB_QUEUE=false: Executes in-process (existing behavior)
 * - USE_JOB_QUEUE=true: Enqueues to BullMQ and returns immediately
 */
export async function chatHandler(ctx: any) {
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
    if (isX402User && auth?.externalId) {
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

    const { conversationStateRecord, stateRecord } = dataSetup.data!;

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

    const createdMessage = messageResult.message!;

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

    // Step 2: Execute planning agent (literature only)
    logger.info(
      {
        message: createdMessage.question,
        existingPlan: conversationState.values.plan?.length || 0,
      },
      "starting_planning_agent",
    );

    const { planningAgent } = await import("../agents/planning");

    const planningResult = await planningAgent({
      state,
      conversationState,
      message: createdMessage,
      mode: "initial",
      usageType: "chat",
    });

    const plan = planningResult.plan;

    logger.info(
      {
        currentObjective: planningResult.currentObjective,
        totalPlannedTasks: plan.length,
        taskTypes: plan.map((t) => t.type),
        taskObjectives: plan.map((t) => t.objective),
      },
      "planning_agent_completed",
    );

    // Filter to only LITERATURE tasks (no ANALYSIS for regular chat)
    const literatureTasks = plan.filter((task) => task.type === "LITERATURE");

    logger.info(
      {
        totalTasks: plan.length,
        literatureTasks: literatureTasks.length,
        analysisTasks: plan.length - literatureTasks.length,
        filteredTasks: literatureTasks.map((t) => ({
          type: t.type,
          objective: t.objective,
        })),
      },
      "tasks_filtered_literature_only",
    );

    if (literatureTasks.length === 0) {
      logger.info("no_literature_tasks_planned_skipping_to_reply");
    }

    // Step 3: Execute literature tasks (OPENSCHOLAR, KNOWLEDGE - no EDISON)
    const { literatureAgent } = await import("../agents/literature");
    const { updateConversationState } = await import("../db/operations");

    const completedTasks: PlanTask[] = [];

    for (const task of literatureTasks) {
      task.start = new Date().toISOString();
      task.output = "";

      logger.info(
        {
          taskObjective: task.objective,
          taskType: task.type,
          taskStart: task.start,
        },
        "executing_literature_task",
      );

      const useBioLiterature =
        process.env.PRIMARY_LITERATURE_AGENT?.toUpperCase() === "BIO";

      // Build list of literature promises based on configured sources
      const literaturePromises: Promise<void>[] = [];

      // OpenScholar (enabled if OPENSCHOLAR_API_URL is configured)
      if (process.env.OPENSCHOLAR_API_URL) {
        const openScholarPromise = literatureAgent({
          objective: task.objective,
          type: "OPENSCHOLAR",
        }).then((result) => {
          if (result.count && result.count > 0) {
            task.output += `${result.output}\n\n`;
          }
          logger.info(
            {
              taskObjective: task.objective,
              outputLength: result.output.length,
              count: result.count,
              outputPreview: result.output.substring(0, 200),
            },
            "openscholar_completed",
          );
        });
        literaturePromises.push(openScholarPromise);
      }

      // BioLit (enabled if PRIMARY_LITERATURE_AGENT=BIO)
      if (useBioLiterature) {
        const bioLiteraturePromise = literatureAgent({
          objective: task.objective,
          type: "BIOLIT",
        }).then((result) => {
          task.output += `${result.output}\n\n`;
          logger.info(
            {
              taskObjective: task.objective,
              outputLength: result.output.length,
              outputPreview: result.output.substring(0, 200),
            },
            "bioliterature_completed",
          );
        });
        literaturePromises.push(bioLiteraturePromise);
      }

      // Knowledge base (enabled if KNOWLEDGE_DOCS_PATH is configured)
      if (process.env.KNOWLEDGE_DOCS_PATH) {
        const knowledgePromise = literatureAgent({
          objective: task.objective,
          type: "KNOWLEDGE",
        }).then((result) => {
          if (result.count && result.count > 0) {
            task.output += `${result.output}\n\n`;
          }
          logger.info(
            {
              taskObjective: task.objective,
              outputLength: result.output.length,
              count: result.count,
            },
            "knowledge_completed",
          );
        });
        literaturePromises.push(knowledgePromise);
      }

      await Promise.all(literaturePromises);

      task.end = new Date().toISOString();
      completedTasks.push(task);

      logger.info(
        {
          taskObjective: task.objective,
          taskType: task.type,
          taskStart: task.start,
          taskEnd: task.end,
          outputLength: task.output?.length || 0,
        },
        "literature_task_completed",
      );
    }

    logger.info(
      {
        completedTasksCount: completedTasks.length,
        totalOutputLength: completedTasks.reduce(
          (sum, t) => sum + (t.output?.length || 0),
          0,
        ),
      },
      "all_literature_tasks_completed",
    );

    // Step 4: Check if hypothesis is needed
    const allLiteratureOutput = completedTasks
      .map((t) => t.output)
      .join("\n\n");

    logger.info(
      {
        question: message,
        literatureOutputLength: allLiteratureOutput.length,
        completedTasksCount: completedTasks.length,
      },
      "checking_if_hypothesis_required",
    );

    const needsHypothesis = await requiresHypothesis(
      message,
      allLiteratureOutput,
      createdMessage.id, // Track token usage per message
    );

    logger.info(
      {
        needsHypothesis,
        question: message,
        completedTasksCount: completedTasks.length,
      },
      "hypothesis_requirement_determined",
    );

    let hypothesisText: string | undefined;

    // Step 5: Generate hypothesis if needed
    if (needsHypothesis && completedTasks.length > 0) {
      logger.info(
        {
          currentObjective: planningResult.currentObjective,
          completedTasksCount: completedTasks.length,
          existingHypothesis: conversationState.values.currentHypothesis,
        },
        "starting_hypothesis_generation",
      );

      const { hypothesisAgent } = await import("../agents/hypothesis");

      const hypothesisResult = await hypothesisAgent({
        objective: planningResult.currentObjective,
        message: createdMessage,
        conversationState,
        completedTasks,
      });

      hypothesisText = hypothesisResult.hypothesis;
      conversationState.values.currentHypothesis = hypothesisText;

      logger.info(
        {
          mode: hypothesisResult.mode,
          hypothesisLength: hypothesisText.length,
          hypothesisPreview: hypothesisText.substring(0, 200),
        },
        "hypothesis_generated",
      );

      if (conversationState.id) {
        await updateConversationState(
          conversationState.id,
          conversationState.values,
        );
        logger.info(
          {
            conversationStateId: conversationState.id,
            mode: hypothesisResult.mode,
          },
          "hypothesis_saved_to_conversation_state",
        );
      }

      // Step 6: Run reflection agent
      logger.info(
        {
          completedTasksCount: completedTasks.length,
          hypothesisLength: hypothesisText.length,
        },
        "starting_reflection_agent",
      );

      const { reflectionAgent } = await import("../agents/reflection");

      const reflectionResult = await reflectionAgent({
        conversationState,
        message: createdMessage,
        completedMaxTasks: completedTasks,
        hypothesis: hypothesisText,
      });

      logger.info(
        {
          currentObjective: reflectionResult.currentObjective,
          keyInsightsCount: reflectionResult.keyInsights.length,
          discoveriesCount: reflectionResult.discoveries.length,
          methodology: reflectionResult.methodology,
          keyInsights: reflectionResult.keyInsights,
          discoveries: reflectionResult.discoveries,
        },
        "reflection_agent_completed",
      );

      // Update conversation state with reflection results
      conversationState.values.currentObjective =
        reflectionResult.currentObjective;
      conversationState.values.keyInsights = reflectionResult.keyInsights;
      conversationState.values.discoveries = reflectionResult.discoveries;
      conversationState.values.methodology = reflectionResult.methodology;

      if (conversationState.id) {
        await updateConversationState(
          conversationState.id,
          conversationState.values,
        );
        logger.info(
          {
            conversationStateId: conversationState.id,
            keyInsightsCount: reflectionResult.keyInsights.length,
            discoveriesCount: reflectionResult.discoveries.length,
          },
          "reflection_results_saved_to_conversation_state",
        );
      }
    } else {
      logger.info(
        {
          needsHypothesis,
          completedTasksCount: completedTasks.length,
          reason: !needsHypothesis
            ? "question_does_not_require_hypothesis"
            : "no_completed_tasks",
        },
        "skipping_hypothesis_and_reflection",
      );
    }

    // Step 7: Generate reply (chat-specific - concise, no next steps)
    logger.info(
      {
        completedTasksCount: completedTasks.length,
        hasHypothesis: !!hypothesisText,
        keyInsightsCount: conversationState.values.keyInsights?.length || 0,
        uploadedDatasetsCount: conversationState.values.uploadedDatasets?.length || 0,
      },
      "starting_chat_reply_generation",
    );

    const { generateChatReply } = await import("../agents/reply/utils");

    const replyText = await generateChatReply(
      message,
      {
        completedTasks,
        hypothesis: hypothesisText,
        nextPlan: [], // No next plan for regular chat
        keyInsights: conversationState.values.keyInsights || [],
        discoveries: conversationState.values.discoveries || [],
        methodology: conversationState.values.methodology,
        currentObjective: conversationState.values.currentObjective,
        uploadedDatasets: conversationState.values.uploadedDatasets || [],
      },
      {
        maxTokens: 1024,
        messageId: createdMessage.id,
        usageType: "chat",
      },
    );

    logger.info(
      {
        replyLength: replyText.length,
        replyPreview: replyText.substring(0, 200),
      },
      "chat_reply_generated",
    );

    const response: ChatV2Response = {
      text: replyText,
      userId, // Include userId so x402 users know their identity
    };

    // Save the response to the message's content field
    const { updateMessage } = await import("../db/operations");
    await updateMessage(createdMessage.id, {
      content: replyText,
    });

    logger.info(
      { messageId: createdMessage.id, contentLength: replyText.length },
      "message_content_saved",
    );

    // Calculate and update response time
    const responseTime = Date.now() - startTime;
    await updateMessageResponseTime(createdMessage.id, responseTime);

    logger.info(
      {
        messageId: createdMessage.id,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
      },
      "response_time_recorded",
    );

    logger.info(
      {
        messageId: createdMessage.id,
        conversationId,
        responseTextLength: response.text?.length || 0,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
        needsHypothesis,
        completedTasksCount: completedTasks.length,
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
