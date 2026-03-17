/**
 * Self-contained types for the agent-based chat mode.
 * Independent from src/llm/types.ts to avoid modifying shared interfaces.
 */

/**
 * A registered tool with its JSON Schema and executor.
 */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema for Anthropic API
  execute: (input: Record<string, unknown>) => Promise<AgentToolResult>;
}

/**
 * Result of executing a tool.
 */
export interface AgentToolResult {
  content: string; // Stringified result for the LLM
  isError?: boolean; // If true, sent as is_error to the model
}

/**
 * Info passed to the onToolResult callback after each tool execution.
 */
export interface ToolCallInfo {
  toolName: string;
  toolCallId: string;
  input: unknown;
  result: AgentToolResult;
  toolCallCount: number; // Running total of tool calls so far
}

/**
 * Configuration for the agent loop.
 */
export interface AgentLoopConfig {
  model: string;
  systemPrompt: string;
  maxToolCalls: number;
  maxTokens: number;
  temperature?: number;
  apiKey: string;
  /** Called after each tool execution. Use for DB state updates, progress notifications, etc. */
  onToolResult?: (info: ToolCallInfo) => Promise<void>;
}

/**
 * Result returned by the agent loop.
 */
export interface AgentLoopResult {
  finalText: string;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  hitMaxTokens?: boolean;
}
