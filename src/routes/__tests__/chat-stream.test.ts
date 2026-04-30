import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ElysiaRouteContext } from "../../types/elysia";
import { chatStreamHandler } from "../chat";

const ENV_KEYS = ["AUTH_MODE", "USE_JOB_QUEUE"] as const;

const savedEnv: Record<string, string | undefined> = {};

function makeContext(body: unknown): ElysiaRouteContext {
  return {
    body,
    params: {},
    query: {},
    request: new Request("http://localhost/api/chat/stream"),
    set: { headers: {} },
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.AUTH_MODE = "none";
  process.env.USE_JOB_QUEUE = "false";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("chatStreamRoute", () => {
  test("validates missing message before opening an SSE stream", async () => {
    const ctx = makeContext({ conversationId: "conv-1" });
    const response = await chatStreamHandler(ctx);

    expect(ctx.set.status).toBe(400);
    expect(response).toEqual({
      error: "Missing required field: message",
      ok: false,
    });
  });

  test("returns an SSE error when queue mode is enabled", async () => {
    process.env.USE_JOB_QUEUE = "true";
    const response = await chatStreamHandler(makeContext({ message: "What is CRISPR?" }));

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Expected Response");
    expect(response.status).toBe(409);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await response.text()).toContain("event: error");
  });
});
