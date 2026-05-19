import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchWithRetry } from "../fetchWithRetry";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchWithRetry", () => {
  test("preserves the default retryable status list", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response("temporary", { status: calls === 1 ? 503 : 200 });
    }) as unknown as typeof fetch;

    const result = await fetchWithRetry("https://example.test", undefined, {
      initialDelayMs: 0,
      maxDelayMs: 0,
      maxRetries: 1,
    });

    expect(result.response.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("allows callers to exclude 503 from retryable statuses", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response("not configured", { status: 503 });
    }) as unknown as typeof fetch;

    const result = await fetchWithRetry("https://example.test", undefined, {
      initialDelayMs: 0,
      maxDelayMs: 0,
      maxRetries: 3,
      retryStatusCodes: [429, 500, 502, 504],
    });

    expect(result.response.status).toBe(503);
    expect(calls).toBe(1);
  });
});
