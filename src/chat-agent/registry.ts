/**
 * Tool registry for the agent-based chat mode.
 * Tools self-register via side-effect imports.
 */

import type { AgentTool, AgentToolResult } from "./types";
import logger from "../utils/logger";

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
export function getToolDefinitions(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return Array.from(tools.values()).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

/**
 * Execute a tool by name. Returns error result if tool not found or throws.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return { content: `Error: Unknown tool "${name}"`, isError: true };
  }
  try {
    return await tool.execute(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ toolName: name, error: message }, "agent_tool_execution_error");
    return { content: `Tool execution error: ${message}`, isError: true };
  }
}

/**
 * Get count of registered tools.
 */
export function getToolCount(): number {
  return tools.size;
}
