import { Elysia } from "elysia";
import type { State } from "../types/core";
import logger from "../utils/logger";
import { generateUUID } from "../utils/uuid";
import { smartAuthMiddleware } from "../middleware/smartAuth";
import { x402Middleware } from "../middleware/x402";
import { ensureUserAndConversation, setupConversationData, X402_SYSTEM_USER_ID } from "../services/chat/setup";
import { recordPayment } from "../services/chat/payment";
import {
  createMessageRecord,
  executeFileUpload,
  executePlanning,
  executeProviderTools,
  executeActionTool,
  executeReflection,
  updateMessageResponseTime,
} from "../services/chat/tools";

type ChatResponse = {
  text: string;
  files?: Array<{
    filename: string;
    mimeType: string;
    size?: number;
  }>;
};

/**
 * Chat Route with Three-Tier Access Control
 *
 * 1. smartAuthMiddleware - Verifies Privy JWT or CDP signature (optional)
 * 2. x402Middleware - Enforces payment (bypassed for Privy users)
 */
const chatRoutePlugin = new Elysia()
  .use(
    smartAuthMiddleware({
      optional: true, // Allow unauthenticated requests (AI agents)
    }),
  )
  .use(x402Middleware());

// GET endpoint for x402scan discovery
// Returns 402 with payment requirements and outputSchema
// The x402Middleware should intercept this and return 402
// If this handler runs, x402 is disabled
export const chatRouteGet = chatRoutePlugin.get("/api/chat", async () => {
  // This should never be reached if x402 is enabled
  // The middleware should intercept and return 402 Payment Required
  const responseData = {
    message: "This endpoint requires POST method with payment.",
    apiDocumentation: "https://your-docs-url.com/api",
  };

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "identity", // Explicitly disable compression
    },
  });
});

export const chatRoute = chatRoutePlugin.post(
  "/api/chat",
  async (ctx) => {
    try {
      const {
        body,
        set,
        request,
        paymentSettlement,
        paymentRequirement,
        paymentHeader,
      } = ctx as any;
      const startTime = Date.now();

      const parsedBody = body as any;
      const authenticatedUser = (request as any).authenticatedUser;

      // Debug: Log request details for MetaMask/Phantom debugging
      if (logger) {
        logger.info({
          contentType: request.headers.get("content-type"),
          hasPaymentHeader: !!paymentHeader,
          hasPaymentSettlement: !!paymentSettlement,
          paymentSettlementSuccess: paymentSettlement?.success,
          paymentSettlementNetwork: paymentSettlement?.network,
          paymentSettlementPayer: paymentSettlement?.payer,
          authMethod: authenticatedUser?.authMethod,
          bodyType: typeof body,
          bodyKeys: body ? Object.keys(body).slice(0, 10) : [],
        }, "chat_route_entry_debug");
      }

    // Extract message (REQUIRED)
    const message = parsedBody.message;
    if (!message) {
      if (logger) {
        logger.warn({ bodyKeys: Object.keys(parsedBody) }, "missing_message_field");
      }
      set.status = 400;
      return {
        ok: false,
        error: "Missing required field: message",
      };
    }

    // Determine userId and source (priority: auth > body > generate)
    let userId: string;
    let source: string;

    if (authenticatedUser) {
      userId = authenticatedUser.userId;

      // Set descriptive source based on auth method
      if (authenticatedUser.authMethod === "privy") {
        source = "external_ui"; // Next.js frontend with Privy
      } else if (authenticatedUser.authMethod === "cdp") {
        source = "dev_ui"; // Internal dev UI with CDP wallets
      } else {
        source = authenticatedUser.authMethod; // Fallback to auth method
      }
    } else {
      // Unauthenticated request
      const providedUserId = parsedBody.userId || `agent_${Date.now()}`;

      // Check if this is from dev UI or an external agent
      // Dev UI sends userId directly, x402 agents pay for access
      if (parsedBody.userId && !paymentSettlement) {
        // Dev UI without x402 - treat as authenticated dev user
        userId = providedUserId;
        source = "dev_ui";
      } else {
        // External AI agent with x402 payment - use system user for persistence
        // Store the provided/generated agent ID in x402_external metadata
        userId = X402_SYSTEM_USER_ID; // All external agents owned by system user
        source = "x402_agent"; // All external agents
      }
    }

    // Auto-generate conversationId if not provided (UUID v4 format)
    let conversationId = parsedBody.conversationId;
    if (!conversationId) {
      conversationId = generateUUID();
      if (logger) {
        logger.info(
          { conversationId, userId },
          "auto_generated_conversation_id",
        );
      }
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
    if (logger) {
      logger.info(
        {
          userId,
          conversationId,
          source,
          authMethod: authenticatedUser?.authMethod,
          paidViaX402: !!paymentSettlement,
          messageLength: message.length,
          fileCount: files.length,
        },
        "chat_request_received",
      );
    }

    // TODO: Implement rate limiting in general
    // - Limit requests per conversationId per time window (e.g., 10 requests/minute)
    // - Track last_request_at in x402_external table
    // - Use Redis or in-memory cache for rate limit counters
    // - Return 429 Too Many Requests with Retry-After header when exceeded

    // Ensure user and conversation exist (auth-aware)
    const setupResult = await ensureUserAndConversation(
      userId,
      conversationId,
      authenticatedUser?.authMethod,
      source,
    );
    if (!setupResult.success) {
      set.status = 500;
      return { ok: false, error: setupResult.error || "Setup failed" };
    }

    // Setup conversation data (state, x402_external record)
    const dataSetup = await setupConversationData(
      conversationId,
      userId,
      source,
      setupResult.isExternal || false,
      message,
      files.length,
      setupResult.isExternal ? (parsedBody.userId || `agent_${Date.now()}`) : undefined,
    );
    if (!dataSetup.success) {
      set.status = 500;
      return { ok: false, error: dataSetup.error || "Data setup failed" };
    }

    const { conversationStateRecord, stateRecord, x402ExternalRecord } =
      dataSetup.data!;

    // Create message record
    const messageResult = await createMessageRecord({
      conversationId,
      userId,
      message,
      source,
      stateId: stateRecord.id,
      files,
      isExternal: setupResult.isExternal || false,
    });
    if (!messageResult.success) {
      set.status = 500;
      return { ok: false, error: messageResult.error || "Message creation failed" };
    }

    const createdMessage = messageResult.message!;

    // Initialize state per request (message-specific state)
    const state: State = {
      id: stateRecord.id,
      values: {
        messageId: createdMessage.id,
        conversationId,
        userId,
        source: createdMessage.source,
      },
    };

    // Initialize conversation state (persistent across messages)
    const conversationState: State = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    const toolContext = {
      state,
      conversationState,
      message: createdMessage,
      files,
    };

    // Step 1: Process files FIRST if present (before planning)
    const fileResult = await executeFileUpload(toolContext);
    if (!fileResult.success) {
      set.status = 500;
      return { ok: false, error: fileResult.error || "File upload failed" };
    }

    // Step 2: Execute planning tool
    const planningResult = await executePlanning(toolContext);
    if (!planningResult.success) {
      set.status = 500;
      return {
        ok: false,
        error: planningResult.error || "Planning execution failed",
      };
    }

    const { providers, actions } = planningResult.result!;

    // Step 3: Parallel execution of provider tools
    await executeProviderTools(providers, toolContext);

    // Step 4: Execute primary action (REPLY or HYPOTHESIS)
    const action = actions?.[0];
    if (!action) {
      set.status = 500;
      return { ok: false, error: "No action specified by planning tool" };
    }

    const actionResult = await executeActionTool(action, toolContext);
    if (!actionResult.success) {
      set.status = 500;
      return { ok: false, error: actionResult.error || "Action execution failed" };
    }

    const primaryActionResult = actionResult.result;

    // Step 5: Execute REFLECTION after primary action completes
    await executeReflection(toolContext);

    // Include file metadata in response if files were uploaded
    const rawFiles = state.values.rawFiles;
    const fileMetadata =
      rawFiles?.length && rawFiles?.length > 0
        ? rawFiles?.map((f: any) => ({
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.metadata?.size,
          }))
        : undefined;

    const response: ChatResponse = {
      text: primaryActionResult.text,
      files: fileMetadata,
    };

    // Calculate and update response time
    const responseTime = Date.now() - startTime;
    await updateMessageResponseTime(
      createdMessage.id,
      responseTime,
      setupResult.isExternal || false,
    );

    // Record payment based on request type
    await recordPayment({
      isExternal: setupResult.isExternal || false,
      x402ExternalRecord,
      userId,
      conversationId,
      messageId: createdMessage.id,
      paymentSettlement,
      paymentHeader,
      paymentRequirement,
      providers: providers ?? [],
      responseTime,
    });

      // Debug: Log response being returned
      if (logger) {
        logger.info({
          responseTextLength: response.text?.length || 0,
          hasFiles: !!response.files,
          fileCount: response.files?.length || 0,
          responseTime,
          paidViaX402: !!paymentSettlement,
        }, "chat_route_returning_response");
      }

      // Return explicit Response object to ensure proper JSON encoding
      // and prevent automatic compression that x402scan can't handle
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity", // Explicitly disable compression
        },
      });
    } catch (error: any) {
      // Catch any unhandled errors and log them
      if (logger) {
        logger.error({
          error: error.message,
          stack: error.stack,
          name: error.name,
        }, "chat_route_unhandled_error");
      }

      const { set } = ctx as any;
      set.status = 500;
      return {
        ok: false,
        error: error.message || "Internal server error",
      };
    }
  },
);
