import { Elysia } from "elysia";
import { smartAuthMiddleware } from "../../middleware/smartAuth";
import { x402Middleware } from "../../middleware/x402";
import { recordPayment } from "../../services/chat/payment";
import {
  ensureUserAndConversation,
  setupConversationData,
  X402_SYSTEM_USER_ID,
} from "../../services/chat/setup";
import {
  createMessageRecord,
  executeActionTool,
  executeFileUpload,
  executePlanning,
  executeProviderTools,
  executeReflection,
  updateMessageResponseTime,
} from "../../services/chat/tools";
import type { State } from "../../types/core";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";

type DeepResearchStartResponse = {
  messageId: string;
  conversationId: string;
  status: "processing";
};

/**
 * Deep Research Start Route - Returns immediately with messageId
 * The actual research runs in the background
 */
const deepResearchStartPlugin = new Elysia()
  .use(
    smartAuthMiddleware({
      optional: true, // Allow unauthenticated requests (AI agents)
    }),
  )
  .use(x402Middleware());

// GET endpoint for x402scan discovery
export const deepResearchStartGet = deepResearchStartPlugin.get(
  "/api/deep-research/start",
  async () => {
    return {
      message: "This endpoint requires POST method with payment.",
      apiDocumentation: "https://your-docs-url.com/api",
    };
  },
);

export const deepResearchStartRoute = deepResearchStartPlugin.post(
  "/api/deep-research/start",
  async (ctx) => {
    const {
      body,
      set,
      request,
      paymentSettlement,
      paymentRequirement,
      paymentHeader,
    } = ctx as any;

    const parsedBody = body as any;
    const authenticatedUser = (request as any).authenticatedUser;

    // Extract message (REQUIRED)
    const message = parsedBody.message;
    if (!message) {
      set.status = 400;
      return {
        ok: false,
        error: "Missing required field: message",
      };
    }

    // Determine userId and source
    let userId: string;
    let source: string;

    if (authenticatedUser) {
      userId = authenticatedUser.userId;

      if (authenticatedUser.authMethod === "privy") {
        source = "external_ui";
      } else if (authenticatedUser.authMethod === "cdp") {
        source = "dev_ui";
      } else {
        source = authenticatedUser.authMethod;
      }
    } else {
      userId = X402_SYSTEM_USER_ID;
      source = "x402_agent";
    }

    // Auto-generate conversationId if not provided
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
          routeType: "deep-research-start",
        },
        "deep_research_start_request_received",
      );
    }

    // Ensure user and conversation exist
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

    // Setup conversation data
    const dataSetup = await setupConversationData(
      conversationId,
      userId,
      source,
      setupResult.isExternal || false,
      message,
      files.length,
      setupResult.isExternal
        ? parsedBody.userId || `agent_${Date.now()}`
        : undefined,
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
      return {
        ok: false,
        error: messageResult.error || "Message creation failed",
      };
    }

    const createdMessage = messageResult.message!;

    // Return immediately with message ID
    const response: DeepResearchStartResponse = {
      messageId: createdMessage.id,
      conversationId,
      status: "processing",
    };

    // Run the actual deep research in the background
    // Don't await - let it run asynchronously
    runDeepResearch({
      stateRecord,
      conversationStateRecord,
      createdMessage,
      files,
      setupResult,
      x402ExternalRecord,
      paymentSettlement,
      paymentHeader,
      paymentRequirement,
    }).catch((err) => {
      logger.error(
        { err, messageId: createdMessage.id },
        "deep_research_background_failed",
      );
    });

    if (logger) {
      logger.info(
        { messageId: createdMessage.id, conversationId },
        "deep_research_started",
      );
    }

    return response;
  },
);

/**
 * Background function that executes the deep research workflow
 */
async function runDeepResearch(params: {
  stateRecord: any;
  conversationStateRecord: any;
  createdMessage: any;
  files: File[];
  setupResult: any;
  x402ExternalRecord: any;
  paymentSettlement: any;
  paymentHeader: any;
  paymentRequirement: any;
}) {
  const {
    stateRecord,
    conversationStateRecord,
    createdMessage,
    files,
    setupResult,
    x402ExternalRecord,
    paymentSettlement,
    paymentHeader,
    paymentRequirement,
  } = params;

  const startTime = Date.now();

  try {
    // Initialize state
    const state: State = {
      id: stateRecord.id,
      values: {
        messageId: createdMessage.id,
        conversationId: createdMessage.conversation_id,
        userId: createdMessage.user_id,
        source: createdMessage.source,
      },
    };

    // Initialize conversation state
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

    // Step 1: Process files
    await executeFileUpload(toolContext);

    // Step 2: Execute planning
    const planningResult = await executePlanning(toolContext);
    if (!planningResult.success) {
      throw new Error(planningResult.error || "Planning failed");
    }

    const { providers, actions } = planningResult.result!;

    // Step 3: Execute provider tools in parallel
    await executeProviderTools(providers, toolContext);

    // Step 4: Execute primary action
    const action = actions?.[0];
    if (!action) {
      throw new Error("No action specified by planning tool");
    }

    const actionResult = await executeActionTool(action, toolContext);
    if (!actionResult.success) {
      throw new Error(actionResult.error || "Action execution failed");
    }

    // Step 5: Execute reflection
    await executeReflection(toolContext);

    // Calculate and update response time
    const responseTime = Date.now() - startTime;
    await updateMessageResponseTime(
      createdMessage.id,
      responseTime,
      setupResult.isExternal || false,
    );

    // Record payment
    await recordPayment({
      isExternal: setupResult.isExternal || false,
      x402ExternalRecord,
      userId: createdMessage.user_id,
      conversationId: createdMessage.conversation_id,
      messageId: createdMessage.id,
      paymentSettlement,
      paymentHeader,
      paymentRequirement,
      providers: providers ?? [],
      responseTime,
    });

    if (logger) {
      logger.info(
        { messageId: createdMessage.id, responseTime },
        "deep_research_completed",
      );
    }
  } catch (err) {
    logger.error(
      { err, messageId: createdMessage.id },
      "deep_research_execution_failed",
    );

    // Update state to mark as failed
    const { updateState } = await import("../../db/operations");
    await updateState(stateRecord.id, {
      ...stateRecord.values,
      error: err instanceof Error ? err.message : "Unknown error",
      status: "failed",
    });
  }
}
