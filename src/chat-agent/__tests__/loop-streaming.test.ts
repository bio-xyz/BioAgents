import { describe, expect, mock, test } from "bun:test";

type MockAnthropicResponse = {
  deltas: string[];
  message: {
    content: unknown[];
    stop_reason: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
};

const streamResponses: MockAnthropicResponse[] = [];

class MockAnthropic {
  messages = {
    create: async () => {
      throw new Error("create should not be used when onTextDelta is configured");
    },
    stream: () => {
      const response = streamResponses.shift();
      if (!response) {
        throw new Error("No mock Anthropic stream response queued");
      }

      return {
        finalMessage: async () => response.message,
        on: (event: string, callback: (delta: string) => void) => {
          if (event === "text") {
            for (const delta of response.deltas) {
              callback(delta);
            }
          }
        },
      };
    },
  };
}

mock.module("@anthropic-ai/sdk", () => ({
  default: MockAnthropic,
}));

const { registerTool } = await import("../registry");
const { runAgentLoop } = await import("../loop");
const proteinStructure = {
  averagePlddt: 82.88,
  bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-Q8W3K0-F1-model_v6.bcif",
  entryId: "AF-Q8W3K0-F1",
  entryUrl: "https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1",
  title: "RPP7",
};

describe("runAgentLoop streaming", () => {
  test("emits token callbacks, pauses before tools, emits tool events, then resumes tokens", async () => {
    const toolName = `stream_probe_${Date.now()}`;
    const seenContexts: unknown[] = [];

    registerTool({
      description: "streaming test tool",
      execute: async (_input, context) => {
        seenContexts.push(context);
        return {
          content: "tool output",
          proteinStructures: [proteinStructure],
        };
      },
      inputSchema: {
        properties: {},
        type: "object",
      },
      name: toolName,
    });

    streamResponses.push(
      {
        deltas: ["I will search."],
        message: {
          content: [
            { text: "I will search.", type: "text" },
            {
              id: "tool-call-1",
              input: { query: "RPP7" },
              name: toolName,
              type: "tool_use",
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      },
      {
        deltas: ["Final answer."],
        message: {
          content: [{ text: "Final answer.", type: "text" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      }
    );

    const events: string[] = [];

    const result = await runAgentLoop("show the RPP7 structure", {
      apiKey: "test-key",
      maxTokens: 1024,
      maxToolCalls: 5,
      model: "claude-test",
      onStreamEvent: (envelope) => {
        events.push(envelope.event);
      },
      onStreamPause: async () => {
        events.push("stream_pause");
      },
      onTextDelta: (delta) => {
        events.push(`delta:${delta}`);
      },
      systemPrompt: "test prompt",
      toolExecutionContext: {
        conversationId: "conversation-1",
        sourceSelectionId: "alphafold_db",
        userMessage: "show the RPP7 structure",
      },
    });

    expect(events).toEqual([
      "delta:I will search.",
      "stream_pause",
      "tool_call",
      "tool_result",
      "delta:Final answer.",
    ]);
    expect(seenContexts).toEqual([
      {
        conversationId: "conversation-1",
        parentToolCallId: "tool-call-1",
        sourceSelectionId: "alphafold_db",
        userMessage: "show the RPP7 structure",
      },
    ]);
    expect(result.finalText).toBe("Final answer.");
    expect(result.proteinStructures).toEqual([proteinStructure]);
    expect(result.totalInputTokens).toBe(15);
    expect(result.totalOutputTokens).toBe(7);
  });
});
