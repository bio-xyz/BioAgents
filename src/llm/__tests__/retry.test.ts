import { afterEach, describe, expect, jest, test } from "bun:test";
import * as retryModule from "../retry";
import {
  calculateBackoffDelay,
  FallbackError,
  getFallbackConfig,
  isRetryableError,
  RETRY_CONFIG,
  withRetry,
} from "../retry";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FallbackError", () => {
  test("carries original error and fallback config", () => {
    const original = new Error("rate limit");
    const err = new FallbackError(
      "PRIMARY_PROVIDER_FAILED:google",
      original,
      "google",
      "gemini-2.5-pro"
    );
    expect(err.name).toBe("FallbackError");
    expect(err.originalError).toBe(original);
    expect(err.fallbackProvider).toBe("google");
    expect(err.fallbackModel).toBe("gemini-2.5-pro");
    expect(err.requiresFallback).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe("isRetryableError", () => {
  test.each([
    ["rate limit exceeded"],
    ["429 too many requests"],
    ["500 internal"],
    ["502 bad gateway"],
    ["503 unavailable"],
    ["504 timeout"],
    ["Server error"],
    ["ECONNRESET on socket"],
    ["ECONNREFUSED"],
    ["socket hang up"],
    ["request timeout"],
    ["network unreachable"],
    ["provider overloaded"],
  ])("treats %s as retryable", (msg) => {
    expect(isRetryableError(new Error(msg))).toBe(true);
  });

  test("unknown errors default to retryable", () => {
    expect(isRetryableError(new Error("mystery failure"))).toBe(true);
    expect(isRetryableError("not an error")).toBe(true);
  });
});

describe("calculateBackoffDelay", () => {
  test("grows by backoffMultiplier at each attempt with zero jitter", () => {
    const deterministic = {
      ...RETRY_CONFIG,
      backoffMultiplier: 2,
      initialDelayMs: 100,
      maxDelayMs: 10_000,
    } as unknown as typeof RETRY_CONFIG;
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.5); // zero jitter
    expect(calculateBackoffDelay(0, deterministic)).toBe(100);
    expect(calculateBackoffDelay(1, deterministic)).toBe(200);
    expect(calculateBackoffDelay(2, deterministic)).toBe(400);
    spy.mockRestore();
  });

  test("respects maxDelayMs ceiling", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    const capped = calculateBackoffDelay(20, RETRY_CONFIG); // 1000 * 2^20 >> maxDelayMs
    expect(capped).toBeLessThanOrEqual(RETRY_CONFIG.maxDelayMs);
  });

  test("jitter stays within ±20% of base", () => {
    // With Math.random() = 0, jitter = -20%; with 1, jitter = +20%
    jest.spyOn(Math, "random").mockReturnValue(0);
    const low = calculateBackoffDelay(0, RETRY_CONFIG);
    jest.spyOn(Math, "random").mockReturnValue(1);
    const high = calculateBackoffDelay(0, RETRY_CONFIG);
    expect(low).toBeGreaterThanOrEqual(Math.floor(RETRY_CONFIG.initialDelayMs * 0.8));
    expect(high).toBeLessThanOrEqual(Math.floor(RETRY_CONFIG.initialDelayMs * 1.2));
  });
});

describe("getFallbackConfig", () => {
  test("returns expected mapping for known providers", () => {
    expect(getFallbackConfig("anthropic")).toEqual({
      model: "gemini-2.5-pro",
      provider: "google",
    });
    expect(getFallbackConfig("google")?.provider).toBe("anthropic");
    expect(getFallbackConfig("openai")?.provider).toBe("google");
    expect(getFallbackConfig("openrouter")?.provider).toBe("google");
  });

  test("returns null for unknown providers", () => {
    expect(getFallbackConfig("claude")).toBeNull();
    expect(getFallbackConfig("")).toBeNull();
  });
});

describe("withRetry", () => {
  test("returns fn result on first success", async () => {
    const fn = jest.fn(() => Promise.resolve("ok"));
    const result = await withRetry(fn, "openai");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries on retryable error and succeeds", async () => {
    jest.spyOn(retryModule, "sleep").mockResolvedValue(undefined);
    let calls = 0;
    const fn = () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("503 service unavailable");
      }
      return Promise.resolve("ok");
    };
    const result = await withRetry(fn, "openai");
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  test("throws original error for unknown provider when all retries exhausted", async () => {
    jest.spyOn(retryModule, "sleep").mockResolvedValue(undefined);
    const boom = new Error("500 server error");
    const fn = jest.fn(() => Promise.reject(boom));
    let caught: unknown;
    try {
      await withRetry(fn, "unknown-provider");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
    expect(fn).toHaveBeenCalledTimes(RETRY_CONFIG.maxRetries);
  });

  test("throws FallbackError when fallback configured", async () => {
    jest.spyOn(retryModule, "sleep").mockResolvedValue(undefined);
    const boom = new Error("rate limit");
    const fn = () => Promise.reject(boom);
    try {
      await withRetry(fn, "anthropic");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FallbackError);
      if (err instanceof FallbackError) {
        expect(err.fallbackProvider).toBe("google");
        expect(err.fallbackModel).toBe("gemini-2.5-pro");
        expect(err.originalError).toBe(boom);
      }
    }
  });

  test("enableFallback: false never throws FallbackError", async () => {
    jest.spyOn(retryModule, "sleep").mockResolvedValue(undefined);
    const boom = new Error("rate limit");
    const fn = () => Promise.reject(boom);
    let caught: unknown;
    try {
      await withRetry(fn, "anthropic", { enableFallback: false });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
  });

  test("fires onRetry and onFallback callbacks", async () => {
    jest.spyOn(retryModule, "sleep").mockResolvedValue(undefined);
    const onRetry = jest.fn();
    const onFallback = jest.fn();
    const fn = () => Promise.reject(new Error("rate limit"));
    let caught: unknown;
    try {
      await withRetry(fn, "anthropic", { onFallback, onRetry });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FallbackError);
    expect(onRetry).toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith("anthropic", "google");
  });
});
