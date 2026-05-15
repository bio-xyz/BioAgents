import { describe, expect, test } from "bun:test";
import { createChatSseEventHandlers } from "../chat-sse-events";

const proteinStructure = {
  averagePlddt: 82.88,
  bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-Q8W3K0-F1-model_v6.bcif",
  entryId: "AF-Q8W3K0-F1",
  entryUrl: "https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1",
  title: "RPP7",
};

describe("createChatSseEventHandlers", () => {
  test("emits token deltas and tool events in one stream before final protein structures", () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const stream = createChatSseEventHandlers({
      conversationId: "conversation-1",
      messageId: "message-1",
      send: (event, data) => events.push({ data, event }),
      userId: "user-1",
    });

    events.push({
      data: { conversationId: "conversation-1", messageId: "message-1" },
      event: "init",
    });
    stream.onTextDelta("Hello ");
    stream.onStreamPause();
    stream.emitStreamEvent({
      data: {
        inputPreview: "RPP7",
        scope: "orchestrator",
        status: "started",
        toolCallId: "tool-call-1",
        toolName: "literature_search",
      },
      event: "tool_call",
    });
    stream.emitStreamEvent({
      data: {
        delta: "AlphaFold hit",
        parentToolCallId: "tool-call-1",
        scope: "literature",
      },
      event: "tool_delta",
    });
    stream.emitStreamEvent({
      data: {
        outputPreview: "AF-Q8W3K0-F1",
        scope: "orchestrator",
        status: "completed",
        toolCallId: "tool-call-1",
        toolName: "literature_search",
      },
      event: "tool_result",
    });
    stream.onTextDelta("world");
    stream.sendFinal({
      proteinStructures: [proteinStructure],
      text: "Hello world",
    });

    expect(events.map((event) => event.event)).toEqual([
      "init",
      "stream_start",
      "delta",
      "stream_end",
      "tool_call",
      "tool_delta",
      "tool_result",
      "stream_start",
      "delta",
      "stream_end",
      "final",
      "done",
    ]);
    expect(events[3]!.data).toEqual({ reason: "paused", turnIndex: 1 });
    expect(events[9]!.data).toEqual({ reason: "complete", turnIndex: 2 });
    expect(events[10]!.data).toEqual({
      conversationId: "conversation-1",
      messageId: "message-1",
      proteinStructures: [proteinStructure],
      text: "Hello world",
      userId: "user-1",
    });
    expect(events[11]!.data).toEqual({ messageId: "message-1" });
  });

  test("emits truncated stream_end before error when a token turn is active", () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const stream = createChatSseEventHandlers({
      conversationId: "conversation-1",
      messageId: "message-1",
      send: (event, data) => events.push({ data, event }),
      userId: "user-1",
    });

    stream.onTextDelta("partial");
    stream.sendTruncated("Response was truncated. Please try a shorter question.");

    expect(events).toContainEqual({
      data: { reason: "truncated", turnIndex: 1 },
      event: "stream_end",
    });
    expect(events.at(-1)).toEqual({
      data: {
        error: "Response was truncated. Please try a shorter question.",
        reason: "truncated",
      },
      event: "error",
    });
  });

  test("includes artifacts in the final event when present", () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const stream = createChatSseEventHandlers({
      conversationId: "conversation-1",
      messageId: "message-1",
      send: (event, data) => events.push({ data, event }),
      userId: "user-1",
    });

    stream.sendFinal({
      artifacts: [
        {
          id: "artifact-1",
          name: "Annotated image",
          path: "artifacts/message-1/annotated.png",
          type: "image",
        },
      ],
      text: "Segmented 1 object.",
    });

    expect(events[0]).toEqual({
      data: {
        artifacts: [
          {
            id: "artifact-1",
            name: "Annotated image",
            path: "artifacts/message-1/annotated.png",
            type: "image",
          },
        ],
        conversationId: "conversation-1",
        messageId: "message-1",
        text: "Segmented 1 object.",
        userId: "user-1",
      },
      event: "final",
    });
  });

  test("emits Segment Anything tool progress before final", () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const stream = createChatSseEventHandlers({
      conversationId: "conversation-1",
      messageId: "message-1",
      send: (event, data) => events.push({ data, event }),
      userId: "user-1",
    });

    stream.emitToolCall({
      inputPreview: "Count the marked object",
      toolCallId: "segment-anything:message-1",
      toolName: "segment-anything",
    });
    stream.emitToolResult({
      outputPreview: "Segmented 1 object.",
      status: "completed",
      toolCallId: "segment-anything:message-1",
      toolName: "segment-anything",
    });
    stream.sendFinal({
      artifacts: [
        {
          id: "segment-anything-message-1",
          name: "Segment Anything result for cells.png",
          path: "artifacts/message-1/segment-anything-annotated.png",
          type: "image",
        },
      ],
      text: "Segmented 1 object.",
    });

    expect(events.map((event) => event.event)).toEqual([
      "tool_call",
      "tool_result",
      "final",
      "done",
    ]);
    expect(events[0]!.data).toMatchObject({
      scope: "orchestrator",
      status: "started",
      toolCallId: "segment-anything:message-1",
      toolName: "segment-anything",
    });
    expect(events[1]!.data).toMatchObject({
      outputPreview: "Segmented 1 object.",
      scope: "orchestrator",
      status: "completed",
      toolCallId: "segment-anything:message-1",
      toolName: "segment-anything",
    });
  });
});
