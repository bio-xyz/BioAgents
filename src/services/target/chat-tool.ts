import type { DataArtifact, TargetToolInput } from "../../types/core";
import logger from "../../utils/logger";

const TARGET_FETCH_TIMEOUT_MS = 65_000;

export class TargetChatToolError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "TargetChatToolError";
    this.statusCode = statusCode;
  }
}

function normalizeToolInput(value: unknown): TargetToolInput {
  if (typeof value === "object" && value !== null) {
    const raw = value as Record<string, unknown>;
    if (typeof raw.query === "string" && raw.query.trim()) {
      return { query: raw.query.trim() };
    }
  }
  throw new TargetChatToolError("Target tool requires a non-empty query.", 400);
}

export async function runTargetChatTool(params: {
  messageId: string;
  message: string;
  toolInput?: unknown;
}): Promise<{ artifacts: DataArtifact[]; text: string }> {
  const { messageId, message } = params;

  const input = normalizeToolInput(
    params.toolInput ?? (message.trim() ? { query: message.trim() } : undefined)
  );

  const baseUrl = process.env.BIO_LIT_AGENT_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.BIO_LIT_AGENT_API_KEY || "";

  if (!baseUrl || !apiKey) {
    throw new TargetChatToolError("Target pipeline service not configured", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TARGET_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/tools/target`, {
      body: JSON.stringify({ query: input.query }),
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      method: "POST",
      signal: controller.signal,
    });
  } catch (err) {
    logger.warn({ err }, "target_chat_tool_request_failed");
    throw new TargetChatToolError("Target pipeline request failed", 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    logger.warn({ errorText, status: response.status }, "target_chat_tool_upstream_error");
    throw new TargetChatToolError(
      `Target pipeline error: ${response.status}`,
      response.status >= 500 ? 502 : response.status
    );
  }

  const targetData = (await response.json()) as Record<string, unknown>;

  const artifact: DataArtifact = {
    description: `Target analysis for ${input.query}`,
    id: `target-${messageId}`,
    metadata: {
      ...targetData,
      _query: input.query,
      _version: 1,
    },
    name: `Target: ${input.query}`,
    type: "target-result",
  };

  const targetInfo = targetData.target as Record<string, unknown> | undefined;
  const uniprotId = typeof targetInfo?.uniprotId === "string" ? targetInfo.uniprotId : input.query;
  const text = `Target analysis complete for ${uniprotId}. Use the result panel to explore binding site residues.`;

  return { artifacts: [artifact], text };
}
