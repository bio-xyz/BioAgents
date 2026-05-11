import { describe, expect, test } from "bun:test";
import type { State } from "../../types/core";
import {
  addVariablesToState,
  cleanWebSearchResults,
  formatConversationHistory,
  parseKeyValueXml,
} from "../state";

function makeState(values: Record<string, any> = {}): State {
  return { values: values as any };
}

describe("addVariablesToState", () => {
  test("merges variables into state", () => {
    const state = makeState({ messageId: "msg-1" });
    addVariablesToState(state, { userId: "user-1" });
    expect(state.values.messageId).toBe("msg-1");
    expect(state.values.userId).toBe("user-1");
  });

  test("overwrites existing keys", () => {
    const state = makeState({ thought: "old" });
    addVariablesToState(state, { thought: "new" });
    expect(state.values.thought).toBe("new");
  });
});

describe("cleanWebSearchResults", () => {
  test("preserves normal titles", () => {
    const results = [
      {
        index: 0,
        originalUrl: "https://example.com",
        title: "A paper title",
        url: "https://example.com",
      },
    ];
    const cleaned = cleanWebSearchResults(results);
    expect(cleaned[0]!.title).toBe("A paper title");
  });

  test("converts URL titles to www.domain format", () => {
    const results = [
      {
        index: 0,
        originalUrl: "",
        title: "https://pubmed.ncbi.nlm.nih.gov/12345",
        url: "https://pubmed.ncbi.nlm.nih.gov/12345",
      },
    ];
    const cleaned = cleanWebSearchResults(results);
    expect(cleaned[0]!.title).toBe("www.pubmed.ncbi.nlm.nih.gov");
  });

  test("handles www. prefix titles", () => {
    const results = [
      { index: 0, originalUrl: "", title: "www.example.com/path", url: "https://example.com/path" },
    ];
    const cleaned = cleanWebSearchResults(results);
    expect(cleaned[0]!.title).toBe("www.example.com");
  });
});

describe("formatConversationHistory", () => {
  test("returns empty string for empty array", () => {
    expect(formatConversationHistory([])).toBe("");
  });

  test("returns empty string for null/undefined", () => {
    expect(formatConversationHistory(null as any)).toBe("");
  });

  test("formats question and content", () => {
    const messages = [{ content: "X is Y.", question: "What is X?" }];
    const result = formatConversationHistory(messages);
    expect(result).toBe("User: What is X?\nAssistant: X is Y.");
  });

  test("handles messages with only question or only content", () => {
    const messages = [{ question: "Q1" }, { content: "A2" }];
    const result = formatConversationHistory(messages);
    expect(result).toBe("User: Q1\nAssistant: A2");
  });
});

describe("parseKeyValueXml", () => {
  test("returns null for empty input", () => {
    expect(parseKeyValueXml("")).toBeNull();
  });

  test("parses <response> block", () => {
    const xml = "<response><title>Hello</title><count>5</count></response>";
    const result = parseKeyValueXml(xml);
    expect(result).toEqual({ count: "5", title: "Hello" });
  });

  test("unescapes XML entities", () => {
    const xml = "<response><text>A &amp; B &lt; C</text></response>";
    const result = parseKeyValueXml(xml);
    expect(result!.text).toBe("A & B < C");
  });

  test("parses comma-separated lists for known keys", () => {
    const xml = "<response><actions>search, analyze, report</actions></response>";
    const result = parseKeyValueXml(xml);
    expect(result!.actions).toEqual(["search", "analyze", "report"]);
  });

  test("parses boolean 'simple' key", () => {
    const xml = "<response><simple>true</simple></response>";
    const result = parseKeyValueXml(xml);
    expect(result!.simple).toBe(true);
  });

  test("falls back to any XML block if no <response>", () => {
    const xml = "<output><key>value</key></output>";
    const result = parseKeyValueXml(xml);
    expect(result).toEqual({ key: "value" });
  });

  test("returns null when no XML tags found", () => {
    expect(parseKeyValueXml("just plain text")).toBeNull();
  });
});
