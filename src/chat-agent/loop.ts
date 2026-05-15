/**
 * Core agent loop for chat mode.
 * Uses @anthropic-ai/sdk directly (not the existing LLM adapter).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  TextBlock,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import logger from "../utils/logger";
import { mergeProteinStructures } from "../utils/proteinStructures";
import { executeTool, getToolDefinitions } from "./registry";
import { previewValue } from "./streaming";
import type { AgentLoopConfig, AgentLoopResult } from "./types";

const DEFAULT_TEMPERATURE = 0.3;

/**
 * Run the agent loop: send message to LLM, execute tool calls, loop until done.
 *
 * When the tool call cap is reached, the next LLM call omits tools
 * to force a text-only response (soft cap).
 */
export async function runAgentLoop(
  userMessage: string,
  config: AgentLoopConfig,
  history?: MessageParam[]
): Promise<AgentLoopResult> {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: 120_000 });
  const toolDefs = getToolDefinitions();

  // Prepend conversation history (if any) before the current user message
  const messages: MessageParam[] = [...(history || []), { content: userMessage, role: "user" }];

  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = "";
  let proteinStructures = mergeProteinStructures();

  while (true) {
    config.signal?.throwIfAborted();
    const isAtCap = toolCallCount >= config.maxToolCalls;

    logger.info(
      { isAtCap, messageCount: messages.length, turn: toolCallCount },
      "agent_loop_turn_start"
    );

    // Build request — omit tools if at cap to force text response
    const requestParams: Anthropic.MessageCreateParams = {
      max_tokens: config.maxTokens,
      messages,
      model: config.model,
      system: config.systemPrompt,
      temperature: config.temperature ?? DEFAULT_TEMPERATURE,
      tool_choice: !isAtCap && toolDefs.length > 0 ? { type: "auto" as const } : undefined,
      tools: !isAtCap && toolDefs.length > 0 ? toolDefs : undefined,
    };

    let response: Anthropic.Message;

    if (config.onTextDelta) {
      // Streaming path: tokens delivered via callback as they arrive
      const stream = client.messages.stream(requestParams, { signal: config.signal });
      stream.on("text", (text) => {
        config.onTextDelta!(text);
      });
      response = await stream.finalMessage();
    } else {
      // Non-streaming path: unchanged behavior for callers without callback
      response = await client.messages.create(requestParams, { signal: config.signal });
    }

    // Track token usage
    if (response.usage) {
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
    }

    // Extract tool_use blocks
    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use"
    );

    // Check max_tokens first — it also has no tool blocks, but needs logging
    if (response.stop_reason === "max_tokens") {
      finalText = response.content
        .filter((block): block is TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");

      logger.warn(
        { hasText: finalText.length > 0, toolCallCount },
        "agent_loop_max_tokens_reached"
      );
      return {
        finalText,
        hitMaxTokens: true,
        proteinStructures,
        toolCallCount,
        totalInputTokens,
        totalOutputTokens,
      };
    }

    // Anthropic Constitutional Classifiers can refuse biology questions.
    // Return early with wasRefused so the runner can fallback to GPT-5.4.
    if (response.stop_reason === "refusal") {
      logger.warn({ contentBlocks: response.content.length, toolCallCount }, "agent_loop_refusal");
      return {
        finalText: "",
        proteinStructures,
        toolCallCount,
        totalInputTokens,
        totalOutputTokens,
        wasRefused: true,
      };
    }

    // If no tool calls — we're done
    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      finalText = response.content
        .filter((block): block is TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");
      break;
    }

    // Notify caller that streaming is pausing for tool execution
    if (config.onStreamPause) {
      try {
        await config.onStreamPause();
      } catch (err) {
        logger.warn({ error: err }, "on_stream_pause_callback_failed");
      }
    }

    // stop_reason === "tool_use" — execute tools
    // Append the full assistant response to message history
    messages.push({
      content: response.content as ContentBlockParam[],
      role: "assistant",
    });

    // Execute each tool and collect results
    const toolResults: ContentBlockParam[] = [];

    for (const toolBlock of toolUseBlocks) {
      toolCallCount++;

      logger.info(
        { toolCallCount, toolCallId: toolBlock.id, toolName: toolBlock.name },
        "agent_tool_call_executing"
      );

      await config.onStreamEvent?.({
        data: {
          inputPreview: previewValue(toolBlock.input),
          scope: "orchestrator",
          status: "started",
          toolCallId: toolBlock.id,
          toolName: toolBlock.name,
        },
        event: "tool_call",
      });

      const toolExecutionContext = config.toolExecutionContext
        ? {
            ...config.toolExecutionContext,
            parentToolCallId: toolBlock.id,
          }
        : undefined;

      const result = await executeTool(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        toolExecutionContext
      );
      proteinStructures = mergeProteinStructures(proteinStructures, result.proteinStructures);

      await config.onStreamEvent?.({
        data: {
          outputPreview: previewValue(result.content),
          scope: "orchestrator",
          status: result.isError ? "failed" : "completed",
          toolCallId: toolBlock.id,
          toolName: toolBlock.name,
        },
        event: "tool_result",
      });

      // Notify caller (e.g. for DB state updates)
      if (config.onToolResult) {
        try {
          await config.onToolResult({
            input: toolBlock.input,
            result,
            toolCallCount,
            toolCallId: toolBlock.id,
            toolName: toolBlock.name,
          });
        } catch (err) {
          logger.warn({ error: err, toolName: toolBlock.name }, "on_tool_result_callback_failed");
          // Don't break the loop — DB update failure shouldn't stop the agent
        }
      }

      // Cast: SDK types don't export ToolResultBlockParam directly
      toolResults.push({
        content: result.content,
        is_error: result.isError ?? false,
        tool_use_id: toolBlock.id,
        type: "tool_result",
      } as unknown as ContentBlockParam);
    }

    // Append tool results as user message (Anthropic convention)
    messages.push({
      content: toolResults,
      role: "user",
    });

    if (toolCallCount >= config.maxToolCalls) {
      logger.warn({ max: config.maxToolCalls, toolCallCount }, "agent_tool_call_cap_reached");
      // Loop continues — next iteration will omit tools, forcing text response
    }
  }

  return {
    finalText,
    proteinStructures,
    toolCallCount,
    totalInputTokens,
    totalOutputTokens,
  };
}
