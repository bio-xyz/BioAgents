/**
 * Core agent loop for chat mode.
 * Uses @anthropic-ai/sdk directly (not the existing LLM adapter).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlockParam,
  ToolUseBlock,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { AgentLoopConfig, AgentLoopResult } from "./types";
import type { SSEWriter } from "./stream";
import { getToolDefinitions, executeTool } from "./registry";
import logger from "../utils/logger";

/**
 * Run the agent loop: send message to LLM, execute tool calls, loop until done.
 *
 * The loop streams text deltas and tool call events via SSE.
 * When the tool call cap is reached, the next LLM call omits tools
 * to force a text-only response (soft cap).
 */
export async function runAgentLoop(
  userMessage: string,
  config: AgentLoopConfig,
  sse: SSEWriter,
): Promise<AgentLoopResult> {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: 120_000 });
  const toolDefs = getToolDefinitions();

  const messages: MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = "";

  while (true) {
    const isAtCap = toolCallCount >= config.maxToolCalls;

    logger.info(
      { turn: toolCallCount, messageCount: messages.length, isAtCap },
      "agent_loop_turn_start",
    );

    // Build request — omit tools if at cap to force text response
    const requestParams: Anthropic.MessageCreateParams = {
      model: config.model,
      system: config.systemPrompt,
      messages,
      max_tokens: config.maxTokens,
      temperature: config.temperature ?? 1,
      tools: !isAtCap && toolDefs.length > 0 ? toolDefs as any : undefined,
      tool_choice: !isAtCap && toolDefs.length > 0 ? { type: "auto" as const } : undefined,
    };

    // Stream text deltas in real-time
    const stream = client.messages.stream(requestParams);

    stream.on("text", (text) => {
      sse.send({ type: "text_delta", content: text });
    });

    const response = await stream.finalMessage();

    // Track token usage
    if (response.usage) {
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
    }

    // Extract tool_use blocks
    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    // If no tool calls — we're done
    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      finalText = response.content
        .filter((block): block is TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");

      await sse.send({ type: "turn_complete", totalToolCalls: toolCallCount });
      break;
    }

    if (response.stop_reason === "max_tokens") {
      finalText = response.content
        .filter((block): block is TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");

      await sse.send({
        type: "error",
        message: "Response truncated: max tokens reached",
        code: "max_tokens",
      });
      await sse.send({ type: "turn_complete", totalToolCalls: toolCallCount });
      break;
    }

    // stop_reason === "tool_use" — execute tools
    // Append the full assistant response to message history
    messages.push({
      role: "assistant",
      content: response.content as ContentBlockParam[],
    });

    // Execute each tool and collect results
    const toolResults: ContentBlockParam[] = [];

    for (const toolBlock of toolUseBlocks) {
      toolCallCount++;

      await sse.send({
        type: "tool_call_start",
        toolName: toolBlock.name,
        toolCallId: toolBlock.id,
        input: toolBlock.input,
      });

      logger.info(
        { toolName: toolBlock.name, toolCallId: toolBlock.id, toolCallCount },
        "agent_tool_call_executing",
      );

      const result = await executeTool(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
      );

      await sse.send({
        type: "tool_call_result",
        toolCallId: toolBlock.id,
        result: result.content,
        isError: result.isError ?? false,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: result.content,
        is_error: result.isError ?? false,
      } as unknown as ContentBlockParam);
    }

    // Append tool results as user message (Anthropic convention)
    messages.push({
      role: "user",
      content: toolResults,
    });

    if (toolCallCount >= config.maxToolCalls) {
      logger.warn(
        { toolCallCount, max: config.maxToolCalls },
        "agent_tool_call_cap_reached",
      );
      // Loop continues — next iteration will omit tools, forcing text response
    }
  }

  return { finalText, toolCallCount, totalInputTokens, totalOutputTokens };
}
