import { afterEach, describe, expect, jest, test } from "bun:test";
import logger from "../../../utils/logger";
import {
  extractTextFromOpenRouterResponse,
  extractWebSearchResultsFromOpenRouterResponse,
  type OpenRouterResponse,
} from "../openrouter-extractors";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("extractTextFromOpenRouterResponse", () => {
  test("returns content from message when present", () => {
    const response: OpenRouterResponse = {
      choices: [{ message: { content: "hello world", role: "assistant" } }],
    };
    expect(extractTextFromOpenRouterResponse(response)).toBe("hello world");
  });

  test("falls back to `text` when message is absent", () => {
    const response: OpenRouterResponse = {
      choices: [{ text: "plain-text response" }],
    };
    expect(extractTextFromOpenRouterResponse(response)).toBe("plain-text response");
  });

  test("returns empty string and warns on empty choices", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const response: OpenRouterResponse = { choices: [] };
    expect(extractTextFromOpenRouterResponse(response)).toBe("");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [ctx, msg] = warnSpy.mock.calls[0] as [{ hasUsage: boolean }, string];
    expect(msg).toBe("openrouter_empty_choices");
    expect(ctx.hasUsage).toBe(false);
  });

  test("returns empty string and warns on missing choices", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const response = { usage: { total_tokens: 5 } } as unknown as OpenRouterResponse;
    expect(extractTextFromOpenRouterResponse(response)).toBe("");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [ctx] = warnSpy.mock.calls[0] as [{ hasUsage: boolean }, string];
    expect(ctx.hasUsage).toBe(true); // usage surfaces even when choices missing
  });

  test("returns empty string silently when first choice is null", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const response = {
      choices: [null],
    } as unknown as OpenRouterResponse;
    expect(extractTextFromOpenRouterResponse(response)).toBe("");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("extractWebSearchResultsFromOpenRouterResponse", () => {
  test("returns empty array and does NOT warn on empty choices", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(extractWebSearchResultsFromOpenRouterResponse({ choices: [] })).toEqual([]);
    // extractText handles the warning to avoid duplicate logs
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("extracts URL citations and keeps insertion order", () => {
    const response: OpenRouterResponse = {
      choices: [
        {
          message: {
            annotations: [
              {
                type: "url_citation",
                url_citation: { title: "A", url: "https://a.example" },
              },
              {
                type: "url_citation",
                url_citation: { title: "B", url: "https://b.example" },
              },
            ],
            content: "x",
            role: "assistant",
          },
        },
      ],
    };
    const results = extractWebSearchResultsFromOpenRouterResponse(response);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      index: 0,
      originalUrl: "https://a.example",
      title: "A",
      url: "https://a.example",
    });
    expect(results[1]?.url).toBe("https://b.example");
  });

  test("deduplicates by URL", () => {
    const response: OpenRouterResponse = {
      choices: [
        {
          message: {
            annotations: [
              { type: "url_citation", url_citation: { title: "1", url: "https://same.example" } },
              { type: "url_citation", url_citation: { title: "2", url: "https://same.example" } },
            ],
            content: "x",
            role: "assistant",
          },
        },
      ],
    };
    expect(extractWebSearchResultsFromOpenRouterResponse(response)).toHaveLength(1);
  });

  test("skips annotations of other types and empty URLs", () => {
    const response: OpenRouterResponse = {
      choices: [
        {
          message: {
            annotations: [
              { type: "other_type", url_citation: { url: "https://ignored.example" } },
              { type: "url_citation" }, // missing url_citation body
              { type: "url_citation", url_citation: { url: "" } },
              { type: "url_citation", url_citation: { url: "https://kept.example" } },
            ],
            content: "x",
            role: "assistant",
          },
        },
      ],
    };
    const results = extractWebSearchResultsFromOpenRouterResponse(response);
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://kept.example");
  });

  test("defaults title to empty string when missing", () => {
    const response: OpenRouterResponse = {
      choices: [
        {
          message: {
            annotations: [
              { type: "url_citation", url_citation: { url: "https://no-title.example" } },
            ],
            content: "x",
            role: "assistant",
          },
        },
      ],
    };
    const results = extractWebSearchResultsFromOpenRouterResponse(response);
    expect(results[0]?.title).toBe("");
  });
});
