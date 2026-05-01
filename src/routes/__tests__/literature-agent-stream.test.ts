import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

const ENV_KEYS = [
  "AUTH_MODE",
  "BIO_LIT_AGENT_API_URL",
  "BIO_LIT_AGENT_API_KEY",
  "USE_JOB_QUEUE",
] as const;

const savedEnv: Record<string, string | undefined> = {};
let originalFetch: typeof fetch;
let routeModule: typeof import("../literature-agent-stream") | undefined;

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function createApp() {
  routeModule ??= await import("../literature-agent-stream");
  return new Elysia().use(routeModule.literatureAgentStreamRoute);
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  originalFetch = globalThis.fetch;

  process.env.AUTH_MODE = "none";
  process.env.BIO_LIT_AGENT_API_URL = "http://literature.test/";
  process.env.BIO_LIT_AGENT_API_KEY = "literature-key";
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

  globalThis.fetch = originalFetch;
});

describe("literatureAgentStreamRoute", () => {
  test("forwards Literature SSE frames and forces fast mode upstream", async () => {
    const frames = [
      'event: run_started\ndata: {"runId":"mock-run","sequence":1}\n\n',
      'event: message_delta\ndata: {"runId":"mock-run","sequence":2,"delta":"CRISPR"}\n\n',
      'event: final\ndata: {"runId":"mock-run","sequence":3,"response":{"answer":"ok"}}\n\n',
    ];
    let upstreamUrl = "";
    let upstreamInit: RequestInit | undefined;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      upstreamUrl = String(input);
      upstreamInit = init;

      return new Response(makeStream(frames), {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    const app = await createApp();
    const response = await app.handle(
      new Request("http://localhost/api/literature/agent/stream", {
        body: JSON.stringify({
          question: " What is CRISPR? ",
          sources: [" pubmed ", "", "open_targets"],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await response.text()).toBe(frames.join(""));

    expect(upstreamUrl).toBe("http://literature.test/query/agent/stream");
    expect(upstreamInit?.method).toBe("POST");

    const headers = new Headers(upstreamInit?.headers);
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-API-Key")).toBe("literature-key");

    expect(JSON.parse(String(upstreamInit?.body))).toEqual({
      mode: "fast",
      question: "What is CRISPR?",
      sources: ["pubmed", "open_targets"],
    });
  });

  test("returns an SSE error event when Literature rejects before streaming", async () => {
    globalThis.fetch = (async () =>
      new Response("bad api key", {
        status: 401,
        statusText: "Unauthorized",
      })) as unknown as typeof fetch;

    const app = await createApp();
    const response = await app.handle(
      new Request("http://localhost/api/literature/agent/stream", {
        body: JSON.stringify({ question: "What is CRISPR?" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await response.text()).toBe(
      'event: error\ndata: {"error":"BioLiterature stream request failed: 401 - bad api key"}\n\n'
    );
  });

  test("validates the request before calling Literature", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch;

    const app = await createApp();
    const response = await app.handle(
      new Request("http://localhost/api/literature/agent/stream", {
        body: JSON.stringify({ question: "" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Missing required field: question",
      ok: false,
    });
    expect(called).toBe(false);
  });

  test("rejects unsupported explicit source IDs", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch;

    const app = await createApp();
    const response = await app.handle(
      new Request("http://localhost/api/literature/agent/stream", {
        body: JSON.stringify({ question: "What is CRISPR?", sources: ["arxiv"] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "sources must be an array of supported literature source IDs",
      ok: false,
    });
    expect(called).toBe(false);
  });
});
