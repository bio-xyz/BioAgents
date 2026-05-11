import { LLM } from "../../llm/provider";
import type { LLMProvider } from "../../types/core";
import logger from "../../utils/logger";
import { reflectionPrompt } from "./prompts";

export type ReflectionDoc = {
  title: string;
  text: string;
  context: string;
};

export type ReflectionOptions = {
  model?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  messageId?: string; // For token usage tracking
  usageType?: "chat" | "deep-research" | "paper-generation";
  // Existing values to preserve on parse failure
  existingObjective?: string;
  existingEvolvingObjective?: string;
  existingInsights?: string[];
  existingMethodology?: string;
  existingTitle?: string;
};

export type ReflectionResult = {
  text: {
    conversationTitle?: string;
    evolvingObjective?: string;
    currentObjective?: string;
    keyInsights: string[];
    discoveries: string[];
    methodology?: string;
  };
  thought?: string;
};

/**
 * Reflect on world state based on completed MAX level tasks
 * Updates: currentObjective, keyInsights, discoveries, methodology
 */
export async function reflectOnWorld(
  question: string,
  documents: ReflectionDoc[],
  options: ReflectionOptions = {}
): Promise<ReflectionResult> {
  const model = process.env.REFLECTION_LLM_MODEL || "gemini-2.5-pro";

  // Build document content
  const documentText = documents
    .map((d) => `Title: ${d.title}\nContext: ${d.context}\n\n${d.text}`)
    .join("\n\n---\n\n");

  // Use reflection prompt
  const reflectionInstruction = reflectionPrompt
    .replace("{{question}}", question)
    .replace("{{documents}}", documentText);

  const REFLECTION_LLM_PROVIDER: LLMProvider =
    (process.env.REFLECTION_LLM_PROVIDER as LLMProvider) || "google";
  const llmApiKey = process.env[`${REFLECTION_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(`${REFLECTION_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`);
  }

  const llmProvider = new LLM({
    apiKey: llmApiKey,
    name: REFLECTION_LLM_PROVIDER,
  });

  const llmRequest = {
    maxTokens: options.maxTokens ?? 4000,
    messageId: options.messageId,
    messages: [
      {
        content: reflectionInstruction,
        role: "user" as const,
      },
    ],
    model,
    thinkingBudget: options.thinking ? (options.thinkingBudget ?? 2048) : undefined,
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
    } catch {
      // try to locate the json inbetween {} in the message content
      const jsonMatch = response.content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      const jsonString = jsonMatch ? jsonMatch[1] || "" : "";
      try {
        parsedResponse = JSON.parse(jsonString);
      } catch {
        logger.warn(
          { content: response.content.substring(0, 300) },
          "reflection_json_parse_failed"
        );
        // Preserve existing values from conversation state
        parsedResponse = {
          conversationTitle: options.existingTitle || "",
          currentObjective: options.existingObjective || "",
          discoveries: [],
          evolvingObjective: options.existingEvolvingObjective || "",
          keyInsights: options.existingInsights || [],
          methodology: options.existingMethodology || "",
        };
      }
    }

    // Validate required fields
    if (!Array.isArray(parsedResponse.keyInsights)) {
      parsedResponse.keyInsights = [];
    }
    if (!Array.isArray(parsedResponse.discoveries)) {
      parsedResponse.discoveries = [];
    }

    logger.info(
      {
        conversationTitle: parsedResponse.conversationTitle,
        discoveriesCount: parsedResponse.discoveries.length,
        docCount: documents.length,
        hasCurrentObjective: !!parsedResponse.currentObjective,
        hasMethodology: !!parsedResponse.methodology,
        insightsCount: parsedResponse.keyInsights.length,
      },
      "reflection_completed"
    );

    return {
      text: {
        conversationTitle: parsedResponse.conversationTitle,
        currentObjective: parsedResponse.currentObjective,
        discoveries: parsedResponse.discoveries,
        evolvingObjective: parsedResponse.evolvingObjective,
        keyInsights: parsedResponse.keyInsights,
        methodology: parsedResponse.methodology,
      },
      thought: undefined, // TODO: Extract thinking if available from response
    };
  } catch (error) {
    logger.error({ error }, "reflection_failed");
    throw error;
  }
}
