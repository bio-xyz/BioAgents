import type { ProteinStructure } from "../types/core";

export type ChatStreamScope = "orchestrator" | "literature";
export type ChatToolStatus = "started" | "running" | "completed" | "failed";

export interface ChatStartedStreamData {
  conversationId: string;
  messageId: string;
}

export interface ChatToolCallStreamData {
  scope: ChatStreamScope;
  toolCallId: string;
  parentToolCallId?: string;
  toolName: string;
  inputPreview?: string;
  status: ChatToolStatus;
}

export interface ChatToolDeltaStreamData {
  scope: "literature";
  parentToolCallId?: string;
  delta: string;
}

export interface ChatToolResultStreamData {
  scope: ChatStreamScope;
  toolCallId: string;
  parentToolCallId?: string;
  toolName: string;
  status: Exclude<ChatToolStatus, "started" | "running">;
  outputPreview?: string;
  outputRef?: string;
}

export interface ChatFinalStreamData {
  conversationId: string;
  messageId: string;
  proteinStructures?: ProteinStructure[];
  text: string;
  userId: string;
}

export interface ChatErrorStreamData {
  error: string;
  code?: string;
}

export type ChatStreamEnvelope =
  | { event: "chat_started"; data: ChatStartedStreamData }
  | { event: "tool_call"; data: ChatToolCallStreamData }
  | { event: "tool_delta"; data: ChatToolDeltaStreamData }
  | { event: "tool_result"; data: ChatToolResultStreamData }
  | { event: "final"; data: ChatFinalStreamData }
  | { event: "error"; data: ChatErrorStreamData }
  | { event: "done"; data: Record<string, never> };

export type ChatStreamEventEmitter = (event: ChatStreamEnvelope) => void | Promise<void>;

export function previewValue(value: unknown, limit = 500): string | undefined {
  if (value === undefined || value === null) return undefined;

  const text = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}
