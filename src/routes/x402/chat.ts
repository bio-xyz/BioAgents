import { Elysia } from "elysia";
import type { State } from "../../types/core";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";
import { ensureUserAndConversation, setupConversationData, X402_SYSTEM_USER_ID } from "../../services/chat/setup";
import { recordPayment } from "../../services/chat/payment";
import {
  createMessageRecord,
  executeFileUpload,
  executePlanning,
  executeProviderTools,
  executeActionTool,
  executeReflection,
  updateMessageResponseTime,
} from "../../services/chat/tools";

type ChatResponse = {
  text: string;
  files?: Array<{
    filename: string;
    mimeType: string;
    size?: number;
  }>;
};

/**
 * x402 Chat Route Plugin
 *
 * Dedicated endpoint for x402 consumers (wallet-based payments)
 * - No authentication required (payment only)
 * - Uses x402_agent source
 * - Creates conversations under system user
 * - x402 payment enforced by global middleware in src/index.ts
 */
export const x402ChatRoute = new Elysia()
  // GET endpoint for x402scan discovery
  .get("/api/x402/chat", async () => {
    const responseData = {
      message: "x402 Chat API - requires POST with X-PAYMENT header",
      documentation: "https://docs.x402.org",
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "identity",
      },
    });
  })
  // POST endpoint for actual chat
  .post(
  "/api/x402/chat",
  async (ctx) => {
    const {
      body,
      set,
      request,
      paymentSettlement,
      paymentRequirement,
      paymentHeader,
    } = ctx as any;

    try {
      const startTime = Date.now();

      const parsedBody = body as any;

      if (logger) {
        logger.info({
          hasPaymentHeader: !!paymentHeader,
          hasPaymentSettlement: !!paymentSettlement,
          paymentSettlementSuccess: paymentSettlement?.success,
          paymentSettlementNetwork: paymentSettlement?.network,
          paymentSettlementPayer: paymentSettlement?.payer,
          source: "x402",
        }, "x402_chat_route_entry");
      }

      // Extract message (REQUIRED)
      const message = parsedBody.message;
      if (!message) {
        if (logger) {
          logger.warn({ bodyKeys: Object.keys(parsedBody) }, "x402_missing_message_field");
        }
        set.status = 400;
        return { error: "Missing required field: message" };
      }

      // Extract optional fields
      const conversationId = parsedBody.conversationId || generateUUID();
      const userId = parsedBody.userId || generateUUID();

      if (logger) {
        logger.info(
          {
            conversationId,
            userId,
            messageLength: message.length,
            source: "x402_agent",
          },
          "x402_chat_request",
        );
      }

      // Files are not supported for x402 in stage 1
      const files: File[] = [];

      // Setup user and conversation (x402_agent source creates conversation under system user)
      const setupResult = await ensureUserAndConversation(
        userId,
        conversationId,
        undefined, // no auth method for x402
        "x402_agent", // source
      );

      if (!setupResult.success) {
        if (logger) logger.error(setupResult, "x402_setup_failed");
        set.status = 500;
        return { error: setupResult.error || "Setup failed" };
      }

      const isExternal = setupResult.isExternal ?? false;

      // Setup conversation data
      const conversationDataResult = await setupConversationData(
        conversationId,
        userId,
        "x402_agent",
        isExternal,
        message,
        files.length,
        userId,
      );

      if (!conversationDataResult.success || !conversationDataResult.data) {
        if (logger) logger.error(conversationDataResult, "x402_conversation_data_setup_failed");
        set.status = 500;
        return { error: conversationDataResult.error || "Failed to setup conversation data" };
      }

      const { conversationStateRecord, stateRecord, x402ExternalRecord } =
        conversationDataResult.data;

      // Create message record
      const messageResult = await createMessageRecord({
        conversationId,
        userId: isExternal ? X402_SYSTEM_USER_ID : userId,
        message,
        source: "x402_agent",
        stateId: stateRecord.id,
        files,
        isExternal,
      });

      if (!messageResult.success || !messageResult.message) {
        if (logger) logger.error(messageResult, "x402_create_message_failed");
        set.status = 500;
        return { error: messageResult.error || "Failed to create message" };
      }

      const createdMessage = messageResult.message;

      if (logger) {
        logger.info(
          { messageId: createdMessage.id, conversationId },
          "x402_message_created",
        );
      }

      // Initialize State objects
      const state: State = {
        id: stateRecord.id,
        values: stateRecord.values,
      };
      const conversationState: State = {
        id: conversationStateRecord.id,
        values: conversationStateRecord.values,
      };

      const context = {
        state,
        conversationState,
        message: createdMessage,
        files,
      };

      // Execute file upload (none for x402 in stage 1)
      await executeFileUpload(context);

      // Execute planning
      const planningResult = await executePlanning(context);
      if (!planningResult.success) {
        if (logger) logger.error(planningResult, "x402_planning_failed");
        set.status = 500;
        return { error: planningResult.error || "Planning failed" };
      }

      const { providers = [], actions = [] } = planningResult.result!;

      if (logger) {
        logger.info({ providers, actions }, "x402_plan_generated");
      }

      // Execute provider tools
      await executeProviderTools(providers, context);

      // Execute action tool
      const action = actions[0] || "REPLY";
      const actionResult = await executeActionTool(action, context);

      if (!actionResult.success) {
        if (logger) logger.error(actionResult, "x402_action_failed");
        set.status = 500;
        return { error: actionResult.error || "Action execution failed" };
      }

      const finalResponse = actionResult.result?.text || "No response generated";

      // Execute reflection (optional)
      await executeReflection(context);

      // Update message with final response
      await updateMessageResponseTime(
        createdMessage.id,
        Date.now() - startTime,
        isExternal,
      );

      // Record payment if settlement occurred
      if (paymentSettlement?.success && paymentRequirement) {
        await recordPayment({
          isExternal,
          conversationId,
          messageId: createdMessage.id,
          userId,
          paymentSettlement,
          paymentRequirement,
          paymentHeader,
          x402ExternalRecord,
          providers,
          responseTime: Date.now() - startTime,
        });
      }

      if (logger) {
        logger.info(
          {
            messageId: createdMessage.id,
            conversationId,
            responseTime: Date.now() - startTime,
          },
          "x402_chat_completed",
        );
      }

      const response: ChatResponse = {
        text: finalResponse,
      };

      if (actionResult.result?.files) {
        response.files = actionResult.result.files;
      }

      return response;
    } catch (error: any) {
      if (logger) {
        logger.error({ err: error }, "x402_chat_route_error");
      }
      set.status = 500;
      return {
        error: "Internal server error",
        message: error?.message || "Unknown error",
      };
    }
  },
);
