import { Elysia, t } from "elysia";
import {
  createConversation,
  createMessage,
  createState,
  createUser,
  updateMessage,
} from "../db/operations";
import { getTool } from "../tools";
import type { State } from "../types/core";
import logger from "../utils/logger";
import { x402Config } from "../x402/config";
import { createPayment } from "../db/x402Operations";
import { usdToBaseUnits } from "../x402/service";
import { x402Middleware } from "../middleware/x402";

type ChatRequest = {
  message: string;
  conversationId: string;
  userId: string;
};

type ChatResponse = {
  text: string;
  files?: Array<{
    filename: string;
    mimeType: string;
    size?: number;
  }>;
};

type ToolResult = { ok: true; data?: unknown } | { ok: false; error: string };

// TODO: This is a temporary safeguard while the repo is WIP
// In production, users and conversations should be created through proper auth/onboarding flows
async function conditionallyCreateMockUserAndConversation(
  userId: string,
  conversationId: string,
): Promise<{ success: boolean; error?: string }> {
  // Ensure user exists (create if not)
  try {
    await createUser({
      id: userId,
      username: `user_${userId.slice(0, 8)}`,
      email: `${userId}@temp.local`,
    });
    if (logger) logger.info({ userId }, "user_created");
  } catch (err: any) {
    // Ignore duplicate key errors (user already exists)
    if (err.code !== "23505") {
      if (logger) logger.error({ err }, "create_user_failed");
      return { success: false, error: "Failed to create user" };
    }
  }

  // Ensure conversation exists (create if not)
  try {
    await createConversation({
      id: conversationId,
      user_id: userId,
    });
    if (logger) logger.info({ conversationId }, "conversation_created");
  } catch (err: any) {
    // Ignore duplicate key errors (conversation already exists)
    if (err.code !== "23505") {
      if (logger) logger.error({ err }, "create_conversation_failed");
      return { success: false, error: "Failed to create conversation" };
    }
  }

  return { success: true };
}

const chatRoutePlugin = new Elysia()
  .use(x402Middleware());

export const chatRoute = chatRoutePlugin.post(
  "/api/chat",
  async (ctx) => {
    const {
      body,
      set,
      request,
      paymentSettlement,
      paymentRequirement,
      paymentHeader,
    } = ctx as any;
    const startTime = Date.now();

    // Handle parsed body (Elysia automatically parses FormData to object)
    let message: string;
    let conversationId: string;
    let userId: string;
    let files: File[] = [];

    const parsedBody = body as any;
    message = parsedBody.message;
    conversationId = parsedBody.conversationId;
    userId = parsedBody.userId;

    // Extract files from parsed body
    if (parsedBody.files) {
      if (Array.isArray(parsedBody.files)) {
        files = parsedBody.files.filter((f: any) => f instanceof File);
      } else if (parsedBody.files instanceof File) {
        files = [parsedBody.files];
      }
    }

    if (files.length > 0) {
      if (logger) logger.info(`Received request with ${files.length} file(s)`);
    }

    // Validate required fields
    if (!message || !conversationId || !userId) {
      set.status = 400;
      return {
        ok: false,
        error: "Missing required fields: message, conversationId, userId",
      };
    }

    const planningTool = getTool("PLANNING");
    if (!planningTool) {
      set.status = 500;
      return { ok: false, error: "Planning tool not found" };
    }

    // Ensure user and conversation exist (WIP safeguard)
    const setupResult = await conditionallyCreateMockUserAndConversation(
      userId,
      conversationId,
    );
    if (!setupResult.success) {
      set.status = 500;
      return { ok: false, error: setupResult.error || "Setup failed" };
    }

    // Create initial state in DB
    let stateRecord;
    try {
      stateRecord = await createState({
        values: {
          conversationId,
          userId,
          source: "ui",
        },
      });
    } catch (err) {
      if (logger) logger.error({ err }, "create_state_failed");
      set.status = 500;
      return { ok: false, error: "Failed to create state" };
    }

    // Create message in DB with state_id and file metadata
    let createdMessage;
    try {
      const fileMetadata = files.length > 0
        ? files.map((f: any) => ({
            name: f.name,
            size: f.size,
            type: f.type,
          }))
        : undefined;

      createdMessage = await createMessage({
        conversation_id: conversationId,
        user_id: userId,
        question: message,
        content: "", // answer will be updated later
        source: "ui", // TODO: source hardcoded for now
        state_id: stateRecord.id,
        files: fileMetadata, // Store file metadata in JSONB field
      });
    } catch (err) {
      if (logger) logger.error({ err }, "create_message_failed");
      set.status = 500;
      return { ok: false, error: "Failed to create message" };
    }

    // Initialize state per request
    const state: State = {
      id: stateRecord.id,
      values: {
        messageId: createdMessage.id,
        conversationId,
        userId,
        source: createdMessage.source,
      },
    };

    // Step 1: Process files FIRST if present (before planning)
    // This allows the file content to be available in state for planning
    if (files.length > 0) {
      const fileUploadTool = getTool("FILE-UPLOAD");
      if (fileUploadTool) {
        try {
          if (logger) logger.info(`Processing ${files.length} uploaded file(s) before planning`);
          await fileUploadTool.execute({
            state,
            message: createdMessage,
            files,
          });
        } catch (err) {
          if (logger) logger.error({ err }, "file_upload_failed");
          set.status = 500;
          return { ok: false, error: "Failed to process uploaded files" };
        }
      }
    }

    // Step 2: Execute planning tool (now with file content available in state)
    let planningResult: {
      providers: string[];
      actions: string[];
    };
    try {
      planningResult = await planningTool.execute({
        state,
        message: createdMessage,
      });

      if (logger) {
        logger.info({
          providers: planningResult.providers,
          action: planningResult.actions[0]
        }, 'Executing plan');
      }

    } catch (err) {
      if (logger) logger.error({ err }, "planning_tool_failed");
      set.status = 500;
      return { ok: false, error: "Planning tool execution failed" };
    }

    // Step 3: Parallel execution of provider tools (excluding FILE-UPLOAD since already done)
    await Promise.all(
      (planningResult.providers ?? []).map(async (provider) => {
        // Skip FILE-UPLOAD since we already processed it
        if (provider === "FILE-UPLOAD") {
          return { provider, result: { ok: true, data: {} } };
        }
        const tool = getTool(provider);
        if (!tool) {
          if (logger) logger.warn({ provider }, "provider_tool_missing");
          const res: ToolResult = {
            ok: false,
            error: `Tool not found for provider: ${provider}`,
          };
          return { provider, result: res };
        }

        try {
          const data = await tool.execute({
            state,
            message: createdMessage,
          });
          const res: ToolResult = { ok: true, data };
          return { provider, result: res };
        } catch (err) {
          if (logger) logger.error({ provider, err }, "provider_tool_failed");
          const res: ToolResult = {
            ok: false,
            error: `Tool execution failed for provider: ${provider}`,
          };
          return { provider, result: res };
        }
      }),
    );

    const action = planningResult.actions?.[0];
    if (!action) {
      set.status = 500;
      return { ok: false, error: "No action specified by planning tool" };
    }

    const actionTool = getTool(action);
    if (!actionTool) {
      set.status = 500;
      return { ok: false, error: `Action tool not found: ${action}` };
    }

    let actionResult: ChatResponse;
    try {
      const r = await actionTool.execute({
        state,
        message: createdMessage,
      });

      // Include file metadata in response if files were uploaded
      const rawFiles = state.values.rawFiles;
      const fileMetadata = rawFiles?.length > 0
        ? rawFiles.map((f: any) => ({
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.metadata?.size,
          }))
        : undefined;

      actionResult = {
        text: r.text,
        files: fileMetadata,
      };
    } catch (err) {
      if (logger) logger.error({ action, err }, "action_tool_failed");
      set.status = 500;
      return { ok: false, error: `Action tool execution failed: ${action}` };
    }

    // Calculate and update response time
    const responseTime = Date.now() - startTime;
    try {
      await updateMessage(createdMessage.id, {
        response_time: responseTime,
      });
    } catch (err) {
      if (logger) logger.error({ err }, "failed_to_update_response_time");
    }

    if (
      x402Config.enabled &&
      paymentSettlement?.txHash &&
      state.values?.estimatedCostUSD
    ) {
      const amountUsdString = String(state.values.estimatedCostUSD);
      const amountUsdNumber = Number.parseFloat(amountUsdString) || 0;

      try {
        // TODO: capture payer address once facilitator response supports it for downstream receipts.
        await createPayment({
          user_id: userId,
          conversation_id: conversationId,
          message_id: createdMessage.id,
          amount_usd: amountUsdNumber,
          amount_wei: usdToBaseUnits(amountUsdString),
          asset: x402Config.asset,
          network: x402Config.network,
          tools_used: planningResult.providers ?? [],
          tx_hash: paymentSettlement.txHash,
          network_id: paymentSettlement.networkId,
          payment_status: "settled",
          payment_header: paymentHeader ? { raw: paymentHeader } : null,
          payment_requirements: paymentRequirement ?? null,
        });
      } catch (err) {
        if (logger) {
          logger.error({ err }, "x402_payment_record_failed");
        }
      }
    }

    return actionResult;
  },
  {
    // Note: Body validation removed to support FormData from frontend
    response: t.Union([
      t.Object({
        text: t.String(),
        files: t.Optional(
          t.Array(
            t.Object({
              filename: t.String(),
              mimeType: t.String(),
              size: t.Optional(t.Number()),
            }),
          ),
        ),
      }),
      t.Object({ ok: t.Literal(false), error: t.String() }),
    ]),
  },
);
