import { createParser } from "eventsource-parser";
import type { ChatStreamEventEmitter } from "../../chat-agent/streaming";
import { previewValue } from "../../chat-agent/streaming";

type JsonObject = Record<string, unknown>;

export interface ConsumeLiteratureStreamOptions {
  stream: ReadableStream<Uint8Array>;
  parentToolCallId?: string;
  emitStreamEvent?: ChatStreamEventEmitter;
}

export interface ConsumeLiteratureStreamResult {
  content: string;
  isError?: boolean;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null ? (value as JsonObject) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseEventData(data: string): JsonObject {
  const parsed = JSON.parse(data) as unknown;
  const payload = asObject(parsed);
  if (!payload) {
    throw new Error("Literature stream event data must be a JSON object");
  }
  return payload;
}

function eventId(payload: JsonObject, fallbackPrefix: string): string {
  const explicit = asString(payload.toolCallId) || asString(payload.runId);
  if (explicit) return explicit;
  return `${fallbackPrefix}:${String(payload.sequence || "unknown")}`;
}

function responseText(payload: JsonObject): string | undefined {
  const response = asObject(payload.response);
  if (!response) return undefined;

  return (
    asString(response.formatted_answer)?.trim() ||
    asString(response.answer)?.trim() ||
    asString(response.text)?.trim() ||
    undefined
  );
}

function responseOutputRef(payload: JsonObject): string | undefined {
  const response = asObject(payload.response);
  const references = response?.references;
  if (!Array.isArray(references)) return undefined;

  for (const reference of references) {
    const item = asObject(reference);
    const ref = asString(item?.url) || asString(item?.doi);
    if (ref) return ref;
  }
}

function errorMessage(payload: JsonObject): string {
  return asString(payload.message) || asString(payload.error) || "Unknown Literature stream error";
}

export async function consumeLiteratureAgentStream({
  emitStreamEvent,
  parentToolCallId,
  stream,
}: ConsumeLiteratureStreamOptions): Promise<ConsumeLiteratureStreamResult> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const pendingEmits: Promise<void>[] = [];
  const fallbackPrefix = parentToolCallId || "literature";
  const deltaParts: string[] = [];
  let finalText = "";
  let streamError: string | undefined;

  function emit(event: Parameters<ChatStreamEventEmitter>[0]) {
    if (!emitStreamEvent) return;
    const maybePromise = emitStreamEvent(event);
    if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
      pendingEmits.push(maybePromise as Promise<void>);
    }
  }

  function handleEvent(eventName: string | undefined, payload: JsonObject) {
    switch (eventName) {
      case "tool_call": {
        emit({
          data: {
            inputPreview: asString(payload.inputPreview) || previewValue(payload.input),
            parentToolCallId,
            scope: "literature",
            status: "started",
            toolCallId: eventId(payload, `${fallbackPrefix}:call`),
            toolName: asString(payload.toolName) || "literature_tool",
          },
          event: "tool_call",
        });
        break;
      }
      case "message_delta": {
        const delta = asString(payload.delta);
        if (!delta) break;
        deltaParts.push(delta);
        emit({
          data: {
            delta,
            parentToolCallId,
            scope: "literature",
          },
          event: "tool_delta",
        });
        break;
      }
      case "tool_result": {
        const status = asString(payload.status) === "failed" ? "failed" : "completed";
        emit({
          data: {
            outputPreview: asString(payload.outputPreview),
            outputRef: asString(payload.outputRef),
            parentToolCallId,
            scope: "literature",
            status,
            toolCallId: eventId(payload, `${fallbackPrefix}:result`),
            toolName: asString(payload.toolName) || "literature_tool",
          },
          event: "tool_result",
        });
        break;
      }
      case "final": {
        finalText = responseText(payload) || finalText;
        emit({
          data: {
            outputPreview: previewValue(finalText || deltaParts.join("")),
            outputRef: responseOutputRef(payload),
            parentToolCallId,
            scope: "literature",
            status: "completed",
            toolCallId: eventId(payload, `${fallbackPrefix}:final`),
            toolName: "literature_agent",
          },
          event: "tool_result",
        });
        break;
      }
      case "error": {
        streamError = errorMessage(payload);
        emit({
          data: {
            outputPreview: streamError,
            parentToolCallId,
            scope: "literature",
            status: "failed",
            toolCallId: eventId(payload, `${fallbackPrefix}:error`),
            toolName: "literature_agent",
          },
          event: "tool_result",
        });
        break;
      }
      default:
        break;
    }
  }

  const parser = createParser({
    onEvent(event) {
      const payload = parseEventData(event.data);
      handleEvent(event.event, payload);
    },
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    if (pendingEmits.length > 0) {
      await Promise.all(pendingEmits.splice(0));
    }
  }

  const trailing = decoder.decode();
  if (trailing) {
    parser.feed(trailing);
  }
  parser.reset({ consume: true });
  if (pendingEmits.length > 0) {
    await Promise.all(pendingEmits.splice(0));
  }

  if (streamError) {
    return {
      content: `Literature stream error: ${streamError}`,
      isError: true,
    };
  }

  const content = finalText || deltaParts.join("").trim();
  if (!content) {
    return {
      content: "No answer received from BioLiterature stream",
      isError: true,
    };
  }

  return { content };
}
