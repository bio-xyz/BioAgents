import { createParser } from "eventsource-parser";
import type { ChatStreamEventEmitter } from "../../chat-agent/streaming";
import { previewValue } from "../../chat-agent/streaming";
import type { ProteinStructure } from "../../types/core";
import {
  extractProteinStructuresFromBioLiteratureResponse,
  mergeProteinStructures,
} from "../../utils/proteinStructures";

type JsonObject = Record<string, unknown>;

export interface ConsumeLiteratureStreamOptions {
  stream: ReadableStream<Uint8Array>;
  parentToolCallId?: string;
  emitStreamEvent?: ChatStreamEventEmitter;
}

export interface ConsumeLiteratureStreamResult {
  content: string;
  isError?: boolean;
  proteinStructures?: ProteinStructure[];
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

function eventId(input: {
  eventName: string;
  fallbackSequence: number;
  parentToolCallId?: string;
  payload: JsonObject;
  toolName: string;
}): string {
  const explicit = asString(input.payload.toolCallId);
  if (explicit) return explicit;

  const parts = [
    input.parentToolCallId || "literature",
    asString(input.payload.runId),
    input.eventName,
    input.toolName,
    String(input.payload.sequence || input.fallbackSequence),
  ].filter(Boolean);

  return parts.join(":");
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
  const deltaParts: string[] = [];
  let fallbackSequence = 0;
  let finalText = "";
  let proteinStructures: ProteinStructure[] = [];
  let streamError: string | undefined;

  function emit(event: Parameters<ChatStreamEventEmitter>[0]) {
    if (!emitStreamEvent) return;
    const maybePromise = emitStreamEvent(event);
    if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
      pendingEmits.push(maybePromise as Promise<void>);
    }
  }

  function handleEvent(eventName: string | undefined, payload: JsonObject) {
    fallbackSequence += 1;

    switch (eventName) {
      case "tool_call": {
        const toolName = asString(payload.toolName) || "literature_tool";
        emit({
          data: {
            inputPreview: asString(payload.inputPreview) || previewValue(payload.input),
            parentToolCallId,
            scope: "literature",
            status: "started",
            toolCallId: eventId({
              eventName,
              fallbackSequence,
              parentToolCallId,
              payload,
              toolName,
            }),
            toolName,
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
        const toolName = asString(payload.toolName) || "literature_tool";
        emit({
          data: {
            outputPreview: asString(payload.outputPreview),
            outputRef: asString(payload.outputRef),
            parentToolCallId,
            scope: "literature",
            status,
            toolCallId: eventId({
              eventName,
              fallbackSequence,
              parentToolCallId,
              payload,
              toolName,
            }),
            toolName,
          },
          event: "tool_result",
        });
        break;
      }
      case "final": {
        finalText = responseText(payload) || finalText;
        proteinStructures = mergeProteinStructures(
          proteinStructures,
          extractProteinStructuresFromBioLiteratureResponse(payload)
        );
        emit({
          data: {
            outputPreview: previewValue(finalText || deltaParts.join("")),
            outputRef: responseOutputRef(payload),
            parentToolCallId,
            scope: "literature",
            status: "completed",
            toolCallId: eventId({
              eventName,
              fallbackSequence,
              parentToolCallId,
              payload,
              toolName: "literature_agent",
            }),
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
            toolCallId: eventId({
              eventName,
              fallbackSequence,
              parentToolCallId,
              payload,
              toolName: "literature_agent",
            }),
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

  return {
    content,
    proteinStructures: proteinStructures.length > 0 ? proteinStructures : undefined,
  };
}
