import { afterEach, describe, expect, jest, test } from "bun:test";
import logger from "../../../utils/logger";
import { parseOpenRouterResponse } from "../openrouter-alpha";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseOpenRouterResponse", () => {
  test("returns parsed data for a well-formed response", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const raw = {
      output_text: "hello",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
    const result = parseOpenRouterResponse(raw);
    expect(result.output_text).toBe("hello");
    expect(result.usage?.total_tokens).toBe(15);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("returns raw cast and warns on schema mismatch", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    // output_text should be string (or similar); object breaks the schema
    const raw = { output_text: { nested: "bad shape" } } as unknown;
    const result: unknown = parseOpenRouterResponse(raw, { url: "https://test/api" });

    expect(result).toBe(raw); // pass-through, not a clone
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [ctx, msg] = warnSpy.mock.calls[0] as [{ issues: unknown[]; url?: string }, string];
    expect(msg).toBe("openrouter_response_schema_mismatch");
    expect(ctx.url).toBe("https://test/api");
    expect(Array.isArray(ctx.issues)).toBe(true);
    expect(ctx.issues.length).toBeGreaterThan(0);
  });

  test("omits url from log when context not supplied", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const raw = { output_text: 42 } as unknown; // number, not string
    parseOpenRouterResponse(raw);
    const [ctx] = warnSpy.mock.calls[0] as [{ url?: string }, string];
    expect(ctx.url).toBeUndefined();
  });

  test("passes through a null raw response rather than throwing", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const result = parseOpenRouterResponse(null);
    expect(result).toBeNull();
    // null fails the schema (not an object), so warn fires
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("accepts a response with only optional fields missing", () => {
    // Empty object — all schema fields are optional, so should parse cleanly
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const result = parseOpenRouterResponse({});
    expect(result).toEqual({});
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
