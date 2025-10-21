import { Elysia, t } from "elysia";
import { getTool } from "../tools";
import type { State } from "../types/core";
import logger from "../utils/logger";

type ChatRequest = {
  message: string;
  conversationId: string;
};

type ChatResponse = {
  text: string;
};

type ToolResult = { ok: true; data?: unknown } | { ok: false; error: string };

export const chatRoute = new Elysia().post(
  "/api/chat",
  async ({ body, set }) => {
    const { message, conversationId } = body as ChatRequest;

    // Initialize state per request
    const state: State = { values: {} };

    const planningTool = getTool("PLANNING");
    if (!planningTool) {
      set.status = 500;
      return { ok: false, error: "Planning tool not found" };
    }

    // TODO: create message in DB, and pass to planning tool later
    const createdMessage = {
      conversationId,
      id: crypto.randomUUID?.() ?? "1",
      createdAt: new Date().toISOString(),
      content: { text: message },
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

    return actionResult;
  },
  {
    body: t.Object({
      message: t.String({ minLength: 1 }),
      conversationId: t.String({ minLength: 1 }),
    }),
    response: t.Union([
      t.Object({ text: t.String() }),
      t.Object({ ok: t.Literal(false), error: t.String() }),
    ]),
  },
);
