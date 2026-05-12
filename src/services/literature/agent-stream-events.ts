import { createParser } from "eventsource-parser";
import type { ChatStreamEventEmitter } from "../../chat-agent/streaming";
import { previewValue } from "../../chat-agent/streaming";
import type { ProteinStructure } from "../../types/core";
import logger from "../../utils/logger";
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch (error) {
    throw new Error("Malformed Literature stream event data", { cause: error });
  }

  const payload = asObject(parsed);
  if (!payload) {
    throw new Error("Literature stream event data must be a JSON object");
  }
  return payload;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  let sawFinal = false;
  let streamError: string | undefined;

  function emitFailureNotification(message: string) {
    if (!emitStreamEvent) return;
    const failedEvent: Parameters<ChatStreamEventEmitter>[0] = {
      data: {
        outputPreview: message,
        parentToolCallId,
        scope: "literature",
        status: "failed",
        toolCallId: eventId({
          eventName: "error",
          fallbackSequence,
          parentToolCallId,
          payload: {},
          toolName: "literature_agent",
        }),
        toolName: "literature_agent",
      },
      event: "tool_result",
    };

    try {
      const maybePromise = emitStreamEvent(failedEvent);
      if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
        pendingEmits.push(
          (maybePromise as Promise<void>).catch((error) => {
            logger.warn({ error, parentToolCallId }, "literature_stream_failure_emit_failed");
          })
        );
      }
    } catch (error) {
      logger.warn({ error, parentToolCallId }, "literature_stream_failure_emit_failed");
    }
  }

  function markStreamEventFailed(input: {
    error: unknown;
    eventName: string | undefined;
    rawEventData: string;
  }) {
    streamError = errorText(input.error);
    logger.warn(
      {
        error: input.error,
        eventName: input.eventName,
        rawEventData: input.rawEventData,
      },
      "literature_stream_event_failed"
    );
    emitFailureNotification(streamError);
  }

  function handleEmitFailure(input: {
    error: unknown;
    eventName: string | undefined;
    rawEventData: string;
  }) {
    if (streamError) {
      logger.warn(
        {
          error: input.error,
          eventName: input.eventName,
          rawEventData: input.rawEventData,
        },
        "literature_stream_emit_failed_after_error"
      );
      return;
    }
    markStreamEventFailed(input);
  }

  function emit(
    event: Parameters<ChatStreamEventEmitter>[0],
    context: { eventName: string | undefined; rawEventData: string }
  ) {
    if (!emitStreamEvent) return;
    try {
      const maybePromise = emitStreamEvent(event);
      if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
        pendingEmits.push(
          (maybePromise as Promise<void>).catch((error) => {
            handleEmitFailure({
              error,
              eventName: context.eventName,
              rawEventData: context.rawEventData,
            });
          })
        );
      }
    } catch (error) {
      handleEmitFailure({
        error,
        eventName: context.eventName,
        rawEventData: context.rawEventData,
      });
    }
  }

  async function flushPendingEmits() {
    while (pendingEmits.length > 0) {
      await Promise.all(pendingEmits.splice(0));
    }
  }

  function handleEvent(eventName: string | undefined, payload: JsonObject, rawEventData: string) {
    fallbackSequence += 1;
    const emitContext = { eventName, rawEventData };

    switch (eventName) {
      case "tool_call": {
        const toolName = asString(payload.toolName) || "literature_tool";
        emit(
          {
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
          },
          emitContext
        );
        break;
      }
      case "message_delta": {
        const delta = asString(payload.delta);
        if (!delta) break;
        deltaParts.push(delta);
        emit(
          {
            data: {
              delta,
              parentToolCallId,
              scope: "literature",
            },
            event: "tool_delta",
          },
          emitContext
        );
        break;
      }
      case "tool_result": {
        const status = asString(payload.status) === "failed" ? "failed" : "completed";
        const toolName = asString(payload.toolName) || "literature_tool";
        emit(
          {
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
          },
          emitContext
        );
        break;
      }
      case "final": {
        sawFinal = true;
        finalText = responseText(payload) || finalText;
        proteinStructures = mergeProteinStructures(
          proteinStructures,
          extractProteinStructuresFromBioLiteratureResponse(payload)
        );
        emit(
          {
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
          },
          emitContext
        );
        break;
      }
      case "error": {
        streamError = errorMessage(payload);
        emit(
          {
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
          },
          emitContext
        );
        break;
      }
      default:
        break;
    }
  }

  const parser = createParser({
    onEvent(event) {
      if (streamError) return;
      try {
        const payload = parseEventData(event.data);
        handleEvent(event.event, payload, event.data);
      } catch (error) {
        markStreamEventFailed({
          error,
          eventName: event.event,
          rawEventData: event.data,
        });
      }
    },
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    await flushPendingEmits();
    if (streamError) {
      await reader.cancel().catch((error) => {
        logger.warn({ error, parentToolCallId }, "literature_stream_reader_cancel_failed");
      });
      break;
    }
  }

  if (!streamError) {
    const trailing = decoder.decode();
    if (trailing) {
      parser.feed(trailing);
    }
    parser.reset({ consume: true });
    await flushPendingEmits();
  }

  if (streamError) {
    return {
      content: `Literature stream error: ${streamError}`,
      isError: true,
    };
  }

  if (!sawFinal) {
    return {
      content: "Literature stream ended before final response",
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
