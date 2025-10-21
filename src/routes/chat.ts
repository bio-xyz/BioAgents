import { Elysia, t } from "elysia";
import {
  createMessage,
  updateMessage,
  createConversation,
  createUser,
} from "../db/operations";
import { getTool } from "../tools";
import type { State } from "../types/core";
import logger from "../utils/logger";

type ChatRequest = {
  message: string;
  conversationId: string;
  userId: string;
};

type ChatResponse = {
  text: string;
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

export const chatRoute = new Elysia().post(
  "/api/chat",
  async ({ body, set, request }) => {
    const startTime = Date.now();

    // Handle FormData (sent from frontend for file upload support)
    let message: string;
    let conversationId: string;
    let userId: string;

    if (body instanceof FormData) {
      message = body.get("message") as string;
      conversationId = body.get("conversationId") as string;
      userId = body.get("userId") as string;
    } else {
      ({ message, conversationId, userId } = body as ChatRequest);
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

    // Create message in DB
    let createdMessage;
    try {
      createdMessage = await createMessage({
        conversation_id: conversationId,
        user_id: userId,
        question: message,
        content: "", // answer will be updated later
        source: "ui", // TODO: source hardcoded for now
      });
    } catch (err) {
      if (logger) logger.error({ err }, "create_message_failed");
      set.status = 500;
      return { ok: false, error: "Failed to create message" };
    }

    // Initialize state per request
    const state: State = {
      values: {
        messageId: createdMessage.id,
        conversationId,
        userId,
        source: createdMessage.source,
      },
    };

    // Execute planning tool
    let planningResult: {
      providers: string[];
      actions: string[];
    };
    try {
      planningResult = await planningTool.execute({
        state,
        message: createdMessage,
      });
    } catch (err) {
      if (logger) logger.error({ err }, "planning_tool_failed");
      set.status = 500;
      return { ok: false, error: "Planning tool execution failed" };
    }

    // Parallel execution of provider tools with failure isolation
    await Promise.all(
      (planningResult.providers ?? []).map(async (provider) => {
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
      actionResult = { text: r.text };
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

    return actionResult;
  },
  {
    // Note: Body validation removed to support FormData from frontend
    response: t.Union([
      t.Object({ text: t.String() }),
      t.Object({ ok: t.Literal(false), error: t.String() }),
    ]),
  },
);
