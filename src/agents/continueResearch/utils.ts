import { LLM } from "../../llm/provider";
import type { Discovery, LLMProvider } from "../../types/core";
import logger from "../../utils/logger";
import { formatFileSize } from "../fileUpload/utils";
import { continueResearchPrompt } from "./prompts";

export type ContinueResearchDoc = {
  title: string;
  text: string;
  context: string;
};

export type DatasetInfo = {
  filename: string;
  id: string;
  description: string;
  size?: number; // File size in bytes
};

export type ContinueResearchOptions = {
  model?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  messageId?: string; // For token usage tracking
  usageType?: "chat" | "deep-research" | "paper-generation";
};

export type ContinueResearchDecision = {
  shouldContinue: boolean;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  triggerReason?: string;
};

/**
 * Call LLM to decide whether to continue research or ask user
 */
export async function decideContinuation(
  originalObjective: string,
  currentObjective: string,
  iterationCount: number,
  hypothesis: string,
  keyInsights: string[],
  discoveries: Discovery[],
  documents: ContinueResearchDoc[],
  suggestedNextSteps: string,
  userLastMessage: string,
  datasets: DatasetInfo[],
  options: ContinueResearchOptions = {},
): Promise<ContinueResearchDecision> {
  const model =
    process.env.CONTINUE_RESEARCH_LLM_MODEL || "claude-sonnet-4-5-20250929";

  // Build document content (all task outputs)
  const allTaskOutputs = documents
    .map((d) => `### ${d.title}\nContext: ${d.context}\n\n${d.text}`)
    .join("\n\n---\n\n");

  // Format key insights
  const keyInsightsText =
    keyInsights.length > 0
      ? keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join("\n")
      : "No key insights yet.";

  // Format discoveries
  const discoveriesText =
    discoveries.length > 0
      ? discoveries.map((d, i) => `${i + 1}. ${d.title}: ${d.claim}`).join("\n")
      : "No discoveries yet.";

  // Format datasets
  const datasetsText =
    datasets.length > 0
      ? datasets
          .map((d, i) => {
            const sizeStr = d.size ? ` [${formatFileSize(d.size)}]` : "";
            return `${i + 1}. ${d.filename}${sizeStr}: ${d.description || "No description"}`;
          })
          .join("\n")
      : "No datasets available.";

  // Build prompt
  const promptInstruction = continueResearchPrompt
    .replace("{{originalObjective}}", originalObjective)
    .replace("{{currentObjective}}", currentObjective || originalObjective)
    .replace("{{iterationCount}}", String(iterationCount))
    .replace("{{hypothesis}}", hypothesis || "No hypothesis formulated yet.")
    .replace("{{insightCount}}", String(keyInsights.length))
    .replace("{{keyInsights}}", keyInsightsText)
    .replace("{{discoveryCount}}", String(discoveries.length))
    .replace("{{discoveries}}", discoveriesText)
    .replace("{{userLastMessage}}", userLastMessage || "No user message.")
    .replace("{{datasetCount}}", String(datasets.length))
    .replace("{{datasets}}", datasetsText)
    .replace("{{allTaskOutputs}}", allTaskOutputs || "No task outputs yet.")
    .replace(
      "{{suggestedNextSteps}}",
      suggestedNextSteps || "No suggested next steps.",
    );

  const CONTINUE_RESEARCH_LLM_PROVIDER: LLMProvider =
    (process.env.CONTINUE_RESEARCH_LLM_PROVIDER as LLMProvider) || "anthropic";
  const llmApiKey =
    process.env[`${CONTINUE_RESEARCH_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(
      `${CONTINUE_RESEARCH_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    name: CONTINUE_RESEARCH_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  const llmRequest = {
    model,
    messages: [
      {
        role: "user" as const,
        content: promptInstruction,
      },
    ],
    maxTokens: options.maxTokens ?? 1024,
    thinkingBudget: options.thinkingBudget,
    messageId: options.messageId,
    usageType: options.usageType,
  };

  try {
    const response = await llmProvider.createChatCompletion(llmRequest);

    // Parse JSON response
    let parsedResponse: ContinueResearchDecision;
    try {
      const cleaned = response.content
        .replace(/```json\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
      parsedResponse = JSON.parse(cleaned);
    } catch (parseError) {
      // Try to locate JSON between {}
      const jsonMatch = response.content.match(/\{[\s\S]*?\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : "";
      try {
        parsedResponse = JSON.parse(jsonString);
      } catch {
        logger.warn(
          { content: response.content.substring(0, 300) },
          "continue_research_json_parse_failed"
        );
        // Default to not continuing - safe to stop and let user decide
        parsedResponse = {
          shouldContinue: false,
          reasoning: "Unable to parse continue decision",
          confidence: "low",
        };
      }
    }

    // Validate required fields
    if (typeof parsedResponse.shouldContinue !== "boolean") {
      throw new Error("Invalid response: missing shouldContinue");
    }
    if (!parsedResponse.reasoning) {
      parsedResponse.reasoning = "No reasoning provided.";
    }
    if (!["high", "medium", "low"].includes(parsedResponse.confidence)) {
      parsedResponse.confidence = "medium";
    }

    logger.info(
      {
        shouldContinue: parsedResponse.shouldContinue,
        confidence: parsedResponse.confidence,
        triggerReason: parsedResponse.triggerReason,
        docCount: documents.length,
        datasetCount: datasets.length,
      },
      "continue_research_decision_made",
    );

    return parsedResponse;
  } catch (error) {
    logger.error({ error }, "continue_research_decision_failed");
    throw error;
  }
}
