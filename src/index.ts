import { Elysia } from "elysia";
import { getTool } from "./tools";
import { type State } from "./types/core";

type ChatRequest = {
  message: string;
  conversationId: string;
};

type ChatResponse = {
  text: string;
};

const app = new Elysia();

app.post("/api/chat", async ({ body }) => {
  const { message, conversationId } = body as ChatRequest;

  const state: State = {
    values: {},
  };

  const planningTool = getTool("PLANNING");
  if (!planningTool) {
    return {
      ok: false,
      error: "Planning tool not found",
    };
  }

  // TODO: create message in DB, and pass to planning tool later
  const createdMessage = {
    conversationId,
    id: "1",
    createdAt: new Date().toISOString(),
    content: { text: message },
  };

  // execute planning tool
  const planningResult = await planningTool.execute({
    state: state,
    message: createdMessage,
  });

  // for each provider in planningResult, execute the tool in parallel
  const providerResults = await Promise.all(
    planningResult.providers.map(async (provider: string) => {
      const tool = getTool(provider);
      if (!tool) {
        return {
          ok: false,
          error: "Tool not found",
        };
      }
      return tool.execute({
        state: state,
        message: createdMessage,
      });
    }),
  );

  const replyTool = getTool("REPLY");
  if (!replyTool) {
    return {
      ok: false,
      error: "Reply tool not found",
    };
  }
  const replyResult = await replyTool.execute({
    state: state,
    message: createdMessage,
  });

  const response: ChatResponse = {
    text: replyResult.text,
  };

  return response;
});

app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
console.log(`Server listening on http://localhost:${process.env.PORT ?? 3000}`);
