import logger from "../../utils/logger";

const UPSTREAM_PATH = "/query/agent/stream";

export type LiteratureAgentStreamRequest = {
  question: string;
  sources?: string[];
  signal?: AbortSignal;
};

export class LiteratureAgentStreamError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LiteratureAgentStreamError";
    this.status = status;
  }
}

function getConfig() {
  const apiUrl = process.env.BIO_LIT_AGENT_API_URL?.trim();
  const apiKey = process.env.BIO_LIT_AGENT_API_KEY?.trim();

  if (!apiUrl || !apiKey) {
    throw new LiteratureAgentStreamError("BioLiterature API URL or API key not configured", 500);
  }

  return {
    apiKey,
    baseUrl: apiUrl.replace(/\/+$/, ""),
  };
}

function truncateErrorBody(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 1000 ? `${trimmed.slice(0, 1000)}...` : trimmed;
}

function buildPayload(input: LiteratureAgentStreamRequest) {
  return {
    mode: "fast",
    question: input.question,
    ...(input.sources?.length ? { sources: input.sources } : {}),
  };
}

export async function openLiteratureAgentStream(
  input: LiteratureAgentStreamRequest
): Promise<ReadableStream<Uint8Array>> {
  const { apiKey, baseUrl } = getConfig();
  const endpoint = `${baseUrl}${UPSTREAM_PATH}`;
  const payload = buildPayload(input);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      body: JSON.stringify(payload),
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      method: "POST",
      signal: input.signal,
    });
  } catch (error) {
    logger.error({ error }, "literature_agent_stream_fetch_failed");
    const message = error instanceof Error ? error.message : String(error);
    throw new LiteratureAgentStreamError(
      `Failed to connect to BioLiterature stream: ${message}`,
      502
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const detail = truncateErrorBody(errorText);

    logger.warn(
      {
        status: response.status,
        statusText: response.statusText,
      },
      "literature_agent_stream_upstream_rejected"
    );

    throw new LiteratureAgentStreamError(
      `BioLiterature stream request failed: ${response.status}${detail ? ` - ${detail}` : ""}`,
      response.status >= 500 ? 502 : response.status
    );
  }

  if (!response.body) {
    throw new LiteratureAgentStreamError("BioLiterature stream response had no body", 502);
  }

  logger.info({ endpoint }, "literature_agent_stream_opened");
  return response.body;
}
