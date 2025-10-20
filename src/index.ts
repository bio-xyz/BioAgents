import { Elysia, t } from "elysia";
import { getTool } from "./tools";
import type { State } from "./types/core";
import logger from "./utils/logger";

type ChatRequest = {
  message: string;
  conversationId: string;
};

type ChatResponse = {
  text: string;
};

type ToolResult = { ok: true; data?: unknown } | { ok: false; error: string };

const app = new Elysia()
  // Basic request logging (optional)
  .onRequest(({ request }) => {
    if (!logger) return;
    logger.info(
      { method: request.method, url: request.url },
      "incoming_request",
    );
  })
  .onError(({ code, error }) => {
    if (!logger) return;
    logger.error({ code, err: error }, "unhandled_error");
  })

  // Input validation for the POST body
  .post(
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
      const providerResults = await Promise.all(
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

      // Optionally: do something with providerResults (aggregate into state, etc.)
      if (logger) logger.debug({ providerResults }, "provider_results_summary");

      const replyTool = getTool("REPLY");
      if (!replyTool) {
        set.status = 500;
        return { ok: false, error: "Reply tool not found" };
      }

      let replyResult: ChatResponse;
      try {
        const r = await replyTool.execute({
          state,
          message: createdMessage,
        });
        replyResult = { text: r.text };
      } catch (err) {
        if (logger) logger.error({ err }, "reply_tool_failed");
        set.status = 500;
        return { ok: false, error: "Reply tool execution failed" };
      }

      return replyResult;
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

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(port, () => {
  if (logger)
    logger.info({ url: `http://localhost:${port}` }, "server_listening");
  else console.log(`Server listening on http://localhost:${port}`);
});
