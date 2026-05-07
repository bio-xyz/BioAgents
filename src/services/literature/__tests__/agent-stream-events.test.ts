import { describe, expect, jest, test } from "bun:test";
import type { ChatStreamEnvelope } from "../../../chat-agent/streaming";
import logger from "../../../utils/logger";
import { consumeLiteratureAgentStream } from "../agent-stream-events";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function makeOpenStream(chunks: string[]): {
  stream: ReadableStream<Uint8Array>;
  wasCanceled: () => boolean;
} {
  const encoder = new TextEncoder();
  let canceled = false;

  return {
    stream: new ReadableStream({
      cancel() {
        canceled = true;
      },
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      },
    }),
    wasCanceled: () => canceled,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms = 100): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("timed out waiting for stream")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timeout!);
  }
}

describe("consumeLiteratureAgentStream", () => {
  test("normalizes split Literature SSE frames into chat tool events", async () => {
    const events: ChatStreamEnvelope[] = [];
    const stream = makeStream([
      'event: tool_call\ndata: {"runId":"run-1","sequence":1,"toolCallId":"call-1",',
      '"toolName":"search_perplexity","inputPreview":"crispr","status":"started"}\n\n',
      'event: message_delta\ndata: {"runId":"run-1","sequence":2,"delta":"partial "}\n\n',
      'event: tool_result\ndata: {"runId":"run-1","sequence":3,"toolCallId":"call-1","toolName":"search_perplexity","status":"completed","outputPreview":"ok","outputRef":"https://example.test"}\n\n',
      'event: final\ndata: {"runId":"run-1","sequence":4,"response":{"answer":"final answer","references":[{"url":"https://paper.test"}]}}\n\n',
    ]);

    const result = await consumeLiteratureAgentStream({
      emitStreamEvent: (event) => {
        events.push(event);
      },
      parentToolCallId: "parent-1",
      stream,
    });

    expect(result).toEqual({ content: "final answer" });
    expect(events).toEqual([
      {
        data: {
          inputPreview: "crispr",
          parentToolCallId: "parent-1",
          scope: "literature",
          status: "started",
          toolCallId: "call-1",
          toolName: "search_perplexity",
        },
        event: "tool_call",
      },
      {
        data: {
          delta: "partial ",
          parentToolCallId: "parent-1",
          scope: "literature",
        },
        event: "tool_delta",
      },
      {
        data: {
          outputPreview: "ok",
          outputRef: "https://example.test",
          parentToolCallId: "parent-1",
          scope: "literature",
          status: "completed",
          toolCallId: "call-1",
          toolName: "search_perplexity",
        },
        event: "tool_result",
      },
      {
        data: {
          outputPreview: "final answer",
          outputRef: "https://paper.test",
          parentToolCallId: "parent-1",
          scope: "literature",
          status: "completed",
          toolCallId: "parent-1:run-1:final:literature_agent:4",
          toolName: "literature_agent",
        },
        event: "tool_result",
      },
    ]);
  });

  test("converts upstream error events into failed tool output", async () => {
    const events: ChatStreamEnvelope[] = [];
    const stream = makeStream([
      'event: error\ndata: {"runId":"run-2","sequence":1,"message":"provider failed"}\n\n',
    ]);

    const result = await consumeLiteratureAgentStream({
      emitStreamEvent: (event) => {
        events.push(event);
      },
      parentToolCallId: "parent-2",
      stream,
    });

    expect(result).toEqual({
      content: "Literature stream error: provider failed",
      isError: true,
    });
    expect(events[0]).toEqual({
      data: {
        outputPreview: "provider failed",
        parentToolCallId: "parent-2",
        scope: "literature",
        status: "failed",
        toolCallId: "parent-2:run-2:error:literature_agent:1",
        toolName: "literature_agent",
      },
      event: "tool_result",
    });
  });

  test("converts malformed Literature SSE data into a failed tool result", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const events: ChatStreamEnvelope[] = [];
    const rawEventData = '{"runId":"run-bad","delta":';
    const stream = makeStream([`event: message_delta\ndata: ${rawEventData}\n\n`]);

    try {
      const result = await consumeLiteratureAgentStream({
        emitStreamEvent: (event) => {
          events.push(event);
        },
        parentToolCallId: "parent-bad",
        stream,
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Literature stream error:");
      expect(events).toContainEqual({
        data: expect.objectContaining({
          outputPreview: expect.stringContaining("Malformed Literature stream event"),
          parentToolCallId: "parent-bad",
          scope: "literature",
          status: "failed",
          toolName: "literature_agent",
        }),
        event: "tool_result",
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "message_delta",
          rawEventData,
        }),
        "literature_stream_event_failed"
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("cancels the upstream reader after a stream event failure", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const rawEventData = '{"runId":"run-bad","delta":';
    const { stream, wasCanceled } = makeOpenStream([
      `event: message_delta\ndata: ${rawEventData}\n\n`,
    ]);

    try {
      const result = await withTimeout(
        consumeLiteratureAgentStream({
          parentToolCallId: "parent-bad",
          stream,
        })
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Literature stream error:");
      expect(wasCanceled()).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("converts stream event handler failures into a failed tool result", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const events: ChatStreamEnvelope[] = [];
    const rawEventData = '{"runId":"run-handler","sequence":1,"delta":"partial"}';
    const stream = makeStream([`event: message_delta\ndata: ${rawEventData}\n\n`]);

    try {
      const result = await consumeLiteratureAgentStream({
        emitStreamEvent: (event) => {
          if (event.event === "tool_delta") {
            throw new Error("handler failed");
          }
          events.push(event);
        },
        parentToolCallId: "parent-handler",
        stream,
      });

      expect(result).toEqual({
        content: "Literature stream error: handler failed",
        isError: true,
      });
      expect(events).toContainEqual({
        data: expect.objectContaining({
          outputPreview: "handler failed",
          parentToolCallId: "parent-handler",
          scope: "literature",
          status: "failed",
          toolName: "literature_agent",
        }),
        event: "tool_result",
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          eventName: "message_delta",
          rawEventData,
        }),
        "literature_stream_event_failed"
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("converts async stream event handler failures into a failed tool result", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const events: ChatStreamEnvelope[] = [];
    const rawEventData = '{"runId":"run-handler","sequence":1,"delta":"partial"}';
    const stream = makeStream([`event: message_delta\ndata: ${rawEventData}\n\n`]);

    try {
      const result = await consumeLiteratureAgentStream({
        emitStreamEvent: async (event) => {
          if (event.event === "tool_delta") {
            throw new Error("async handler failed");
          }
          events.push(event);
        },
        parentToolCallId: "parent-handler",
        stream,
      });

      expect(result).toEqual({
        content: "Literature stream error: async handler failed",
        isError: true,
      });
      expect(events).toContainEqual({
        data: expect.objectContaining({
          outputPreview: "async handler failed",
          parentToolCallId: "parent-handler",
          scope: "literature",
          status: "failed",
          toolName: "literature_agent",
        }),
        event: "tool_result",
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          eventName: "message_delta",
          rawEventData,
        }),
        "literature_stream_event_failed"
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("treats a stream ending without final as an error even when deltas arrived", async () => {
    const stream = makeStream([
      'event: message_delta\ndata: {"runId":"run-partial","sequence":1,"delta":"partial answer"}\n\n',
    ]);

    const result = await consumeLiteratureAgentStream({ stream });

    expect(result).toEqual({
      content: "Literature stream ended before final response",
      isError: true,
    });
  });

  test("derives unique fallback tool ids when upstream omits ids and sequences", async () => {
    const events: ChatStreamEnvelope[] = [];
    const stream = makeStream([
      'event: tool_call\ndata: {"toolName":"search_alphafold","inputPreview":"seq"}\n\n',
      'event: tool_result\ndata: {"toolName":"search_alphafold","status":"completed","outputPreview":"ok"}\n\n',
      'event: final\ndata: {"response":{"answer":"final answer"}}\n\n',
    ]);

    await consumeLiteratureAgentStream({
      emitStreamEvent: (event) => {
        events.push(event);
      },
      parentToolCallId: "parent-3",
      stream,
    });

    const toolCallIds = events
      .filter((event) => event.event !== "tool_delta")
      .map((event) => ("toolCallId" in event.data ? event.data.toolCallId : undefined));

    expect(new Set(toolCallIds).size).toBe(toolCallIds.length);
    expect(toolCallIds).toEqual([
      "parent-3:tool_call:search_alphafold:1",
      "parent-3:tool_result:search_alphafold:2",
      "parent-3:final:literature_agent:3",
    ]);
  });

  test("extracts AlphaFold protein structures from final tool results", async () => {
    const stream = makeStream([
      'event: final\ndata: {"runId":"run-3","sequence":1,"response":{"answer":"final answer","tool_results":{"search_alphafold":{"results":[{"id":"AF-Q8W3K0-F1","title":"RPP7","url":"https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1","source":"alphafold_db","metadata":{"entryId":"AF-Q8W3K0-F1","entryUrl":"https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1","bcifUrl":"https://alphafold.ebi.ac.uk/files/AF-Q8W3K0-F1-model_v6.bcif","averagePlddt":82.88,"gene":"RPP7"}}]}}}}\n\n',
    ]);

    const result = await consumeLiteratureAgentStream({ stream });

    expect(result.proteinStructures).toEqual([
      {
        averagePlddt: 82.88,
        bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-Q8W3K0-F1-model_v6.bcif",
        entryId: "AF-Q8W3K0-F1",
        entryUrl: "https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1",
        gene: "RPP7",
        title: "RPP7",
      },
    ]);
  });
});
