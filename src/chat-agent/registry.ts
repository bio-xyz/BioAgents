/**
 * Tool registry for the agent-based chat mode.
 * Tools self-register via side-effect imports.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import logger from "../utils/logger";
import type { AgentTool, AgentToolExecutionContext, AgentToolResult } from "./types";

const tools = new Map<string, AgentTool>();

/**
 * Register a tool. Skips silently if already registered (idempotent).
 */
export function registerTool(tool: AgentTool): void {
  if (tools.has(tool.name)) {
    logger.debug({ toolName: tool.name }, "agent_tool_already_registered");
    return;
  }
  tools.set(tool.name, tool);
  logger.info({ toolName: tool.name }, "agent_tool_registered");
}

/**
 * Returns tools in Anthropic API format for the `tools` parameter.
 */
export function getToolDefinitions(): Tool[] {
  return Array.from(tools.values()).map((t) => ({
    description: t.description,
    input_schema: {
      type: "object",
      ...t.inputSchema,
    },
    name: t.name,
  }));
}

/**
 * Execute a tool by name. Returns error result if tool not found or throws.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context?: AgentToolExecutionContext
): Promise<AgentToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return { content: `Error: Unknown tool "${name}"`, isError: true };
  }
  try {
    return await tool.execute(input, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message, toolName: name }, "agent_tool_execution_error");
    return { content: `Tool execution error: ${message}`, isError: true };
  }
}

/**
 * Get count of registered tools.
 */
export function getToolCount(): number {
  return tools.size;
}
