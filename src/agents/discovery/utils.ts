import { LLM } from "../../llm/provider";
import type { Discovery, LLMProvider, PlanTask, AnalysisArtifact } from "../../types/core";
import logger from "../../utils/logger";
import { discoveryPrompt } from "./prompts";

export type DiscoveryDoc = {
  title: string;
  text: string;
  context: string;
};

export type DiscoveryOptions = {
  model?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  messageId?: string; // For token usage tracking
  usageType?: "chat" | "deep-research" | "paper-generation";
};

export type DiscoveryResult = {
  discoveries: Discovery[];
};

/**
 * Extract and update discoveries from completed MAX level tasks
 */
export async function extractDiscoveries(
  question: string,
  existingDiscoveries: Discovery[],
  conversationHistory: string,
  documents: DiscoveryDoc[],
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const model = process.env.DISCOVERY_LLM_MODEL || "gemini-2.5-pro";

  // Build document content
  const documentText = documents
    .map((d) => `Title: ${d.title}\nContext: ${d.context}\n\n${d.text}`)
    .join("\n\n---\n\n");

  // Format existing discoveries
  const formattedDiscoveries =
    existingDiscoveries.length > 0
      ? JSON.stringify(existingDiscoveries, null, 2)
      : "No existing discoveries yet.";

  // Use discovery prompt
  const discoveryInstruction = discoveryPrompt
    .replace("{{question}}", question)
    .replace("{{existingDiscoveries}}", formattedDiscoveries)
    .replace("{{conversationHistory}}", conversationHistory)
    .replace("{{documents}}", documentText);

  const DISCOVERY_LLM_PROVIDER: LLMProvider =
    (process.env.DISCOVERY_LLM_PROVIDER as LLMProvider) || "google";
  const llmApiKey =
    process.env[`${DISCOVERY_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(
      `${DISCOVERY_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    name: DISCOVERY_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  const llmRequest = {
    model,
    messages: [
      {
        role: "user" as const,
        content: discoveryInstruction,
      },
    ],
    maxTokens: options.maxTokens ?? 8000,
    thinkingBudget: options.thinking
      ? (options.thinkingBudget ?? 4096)
      : undefined,
    messageId: options.messageId,
    usageType: options.usageType,
  };

  try {
    const response = await llmProvider.createChatCompletion(llmRequest);

    // Parse JSON response
    let parsedResponse;
    try {
      const cleaned = response.content
        .replace(/```json\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
      parsedResponse = JSON.parse(cleaned);
    } catch (parseError) {
      // try to locate the json inbetween {} in the message content
      const jsonMatch = response.content.match(
        /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,
      );
      const jsonString = jsonMatch ? jsonMatch[1] || "" : "";
      try {
        parsedResponse = JSON.parse(jsonString);
      } catch {
        logger.warn(
          { content: response.content.substring(0, 300) },
          "discovery_json_parse_failed"
        );
        // Preserve existing discoveries from conversation state
        parsedResponse = { discoveries: existingDiscoveries };
      }
    }

    // Validate required fields
    if (!Array.isArray(parsedResponse.discoveries)) {
      parsedResponse.discoveries = [];
    }

    logger.info(
      {
        discoveryCount: parsedResponse.discoveries.length,
        docCount: documents.length,
        existingDiscoveriesCount: existingDiscoveries.length,
      },
      "discovery_extraction_completed",
    );

    return {
      discoveries: parsedResponse.discoveries,
    };
  } catch (error) {
    logger.error({ error }, "discovery_extraction_failed");
    throw error;
  }
}

/**
 * Fix discovery artifact paths by matching against task artifacts.
 * The LLM may output sandbox paths (like /home/user/...) or just filenames -
 * we match by filename and copy the correct path from task artifacts.
 */
export function fixDiscoveryArtifactPaths(
  discoveries: Discovery[],
  tasks: PlanTask[],
): Discovery[] {
  // Build lookup map: filename -> correct artifact
  const artifactsByName = new Map<string, AnalysisArtifact>();
  for (const task of tasks) {
    if (!task.artifacts) continue;
    for (const artifact of task.artifacts) {
      if (artifact.name) {
        artifactsByName.set(artifact.name, artifact);
      }
      // Also index by path basename
      if (artifact.path) {
        const basename = artifact.path.split("/").pop() || "";
        if (basename) artifactsByName.set(basename, artifact);
      }
    }
  }

  return discoveries.map((discovery) => ({
    ...discovery,
    artifacts: (discovery.artifacts || []).map((artifact) => {
      // Try to find matching task artifact by name
      const matchByName = artifact.name
        ? artifactsByName.get(artifact.name)
        : null;
      if (matchByName?.path) {
        return { ...artifact, path: matchByName.path };
      }

      // Try to find by path basename (LLM may use filename as path)
      if (artifact.path) {
        const basename = artifact.path.split("/").pop() || "";
        const matchByBasename = artifactsByName.get(basename);
        if (matchByBasename?.path) {
          return { ...artifact, path: matchByBasename.path };
        }
      }

      return artifact;
    }),
  }));
}
