import { describe, expect, test } from "bun:test";
import { executeTool, registerTool } from "../registry";
import type { AgentToolExecutionContext } from "../types";

describe("chat-agent registry", () => {
  test("passes execution context to tools", async () => {
    const toolName = `test_context_tool_${Date.now()}`;
    let receivedContext: AgentToolExecutionContext | undefined;

    registerTool({
      description: "test tool",
      execute: async (_input, context) => {
        receivedContext = context;
        return { content: "ok" };
      },
      inputSchema: {
        properties: {},
        type: "object",
      },
      name: toolName,
    });

    const context: AgentToolExecutionContext = {
      conversationId: "conversation-1",
      sourceSelectionId: "alphafold_db",
      userMessage:
        "Protein sequence: MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP",
    };

    const result = await executeTool(toolName, {}, context);

    expect(result).toEqual({ content: "ok" });
    expect(receivedContext).toEqual(context);
  });
});
