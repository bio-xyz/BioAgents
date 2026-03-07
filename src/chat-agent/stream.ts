/**
 * SSE streaming utilities for the agent-based chat mode.
 */

import type { AgentSSEEvent } from "./types";

/**
 * Encode an SSE event into wire format.
 */
export function encodeSSEEvent(event: AgentSSEEvent): string {
  const data = JSON.stringify(event);
  return `event: ${event.type}\ndata: ${data}\n\n`;
}

/**
 * Wraps a WritableStreamDefaultWriter for typed SSE event writing.
 * Silently drops writes if the client disconnects.
 */
export class SSEWriter {
  private encoder = new TextEncoder();
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private closed = false;

  constructor(writer: WritableStreamDefaultWriter<Uint8Array>) {
    this.writer = writer;
  }

  async send(event: AgentSSEEvent): Promise<void> {
    if (this.closed) return;
    try {
      const encoded = this.encoder.encode(encodeSSEEvent(event));
      await this.writer.write(encoded);
    } catch {
      this.closed = true;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.writer.close();
    } catch {
      // Already closed
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Create a streaming SSE Response.
 * Returns [Response, SSEWriter] — the route returns the Response,
 * and the agent loop writes events to the SSEWriter.
 */
export function createSSEResponse(): [Response, SSEWriter] {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = new SSEWriter(writable.getWriter());

  const response = new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });

  return [response, writer];
}

/**
 * No-op SSEWriter for JSON mode.
 * The agent loop calls send()/close() but nothing is written anywhere.
 * This lets the loop run identically in both SSE and JSON modes.
 */
export class NoOpSSEWriter extends SSEWriter {
  constructor() {
    // Create a dummy writer that we'll never use
    const { writable } = new TransformStream<Uint8Array>();
    super(writable.getWriter());
  }

  override async send(_event: AgentSSEEvent): Promise<void> {
    // No-op
  }

  override async close(): Promise<void> {
    // No-op
  }

  override get isClosed(): boolean {
    return false;
  }
}
