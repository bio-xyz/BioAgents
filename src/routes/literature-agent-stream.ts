import { Elysia } from "elysia";
import { authResolver } from "../middleware/authResolver";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import {
  LiteratureAgentStreamError,
  openLiteratureAgentStream,
} from "../services/literature/agent-stream";
import type { ElysiaRouteContext } from "../types/elysia";
import { asString, isBodyRecord } from "../utils/bodyParsing";
import logger from "../utils/logger";

const STREAM_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
};

const LITERATURE_AGENT_SOURCE_IDS = [
  "alphafold_db",
  "uniprot",
  "pdb",
  "pubmed",
  "chembl",
  "ensembl",
  "enrichr",
  "clinical-trials",
  "open_targets",
] as const;

const LITERATURE_AGENT_SOURCE_ID_SET = new Set<string>(LITERATURE_AGENT_SOURCE_IDS);

export const literatureAgentStreamRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true,
      }),
      rateLimitMiddleware("chat"),
    ],
  },
  (app) => app.post("/api/literature/agent/stream", literatureAgentStreamHandler)
);

function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createSseErrorResponse(error: unknown): Response {
  const status = error instanceof LiteratureAgentStreamError ? error.status : 500;
  const message = error instanceof Error ? error.message : String(error);

  return new Response(encodeSseEvent("error", { error: message }), {
    headers: STREAM_HEADERS,
    status,
  });
}

function parseSources(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;

  const sources: string[] = [];
  for (const source of value) {
    if (typeof source !== "string") return null;

    const trimmed = source.trim();
    if (!trimmed) continue;
    if (!LITERATURE_AGENT_SOURCE_ID_SET.has(trimmed)) return null;
    sources.push(trimmed);
  }

  return sources.length > 0 ? sources : undefined;
}

export async function literatureAgentStreamHandler(ctx: ElysiaRouteContext) {
  const { body, request, set } = ctx;
  const parsedBody = isBodyRecord(body) ? body : {};
  const question = asString(parsedBody.question)?.trim();

  if (!request.auth?.userId) {
    set.status = 401;
    return {
      error: "Authentication required",
      ok: false,
    };
  }

  if (!question) {
    set.status = 400;
    return {
      error: "Missing required field: question",
      ok: false,
    };
  }

  const sources = parseSources(parsedBody.sources);
  if (sources === null) {
    set.status = 400;
    return {
      error: "sources must be an array of supported literature source IDs",
      ok: false,
    };
  }

  try {
    const stream = await openLiteratureAgentStream({
      question,
      signal: request.signal,
      sources,
    });

    return new Response(stream, {
      headers: STREAM_HEADERS,
      status: 200,
    });
  } catch (error) {
    logger.error({ error }, "literature_agent_stream_bridge_failed");
    return createSseErrorResponse(error);
  }
}
