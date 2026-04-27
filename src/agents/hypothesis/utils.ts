import { LLM } from "../../llm/provider";
import type { LLMProvider } from "../../types/core";
import logger from "../../utils/logger";
import { hypGenDeepResearchPrompt } from "./prompts";

export type HypothesisDoc = {
  title: string;
  text: string;
  context: string;
};

export type HypothesisOptions = {
  model?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  mode?: "create" | "update";
  messageId?: string; // For token usage tracking
  usageType?: "chat" | "deep-research" | "paper-generation";
};

export type HypothesisResult = {
  text: string;
  thought?: string;
};

/**
 * Generate or update hypothesis based on documents
 * Always uses deep research mode
 */
export async function generateHypothesis(
  question: string,
  documents: HypothesisDoc[],
  options: HypothesisOptions = {}
): Promise<HypothesisResult> {
  const model = process.env.HYP_LLM_MODEL || "gemini-2.5-pro";
  const mode = options.mode ?? "create";

  // Build document content
  const documentText = documents.map((d) => `Title: ${d.title}\n\n${d.text}`).join("\n\n\n");

  // Use deep research prompt
  let hypGenInstruction = hypGenDeepResearchPrompt.replace("{{question}}", question);

  // Add mode-specific instructions
  if (mode === "update") {
    hypGenInstruction += `\n\nIMPORTANT: You are UPDATING an existing hypothesis. The current hypothesis is included in the documents. Refine and improve it based on the new findings, but maintain consistency with the overall research direction.`;
  }

  const HYP_LLM_PROVIDER: LLMProvider = (process.env.HYP_LLM_PROVIDER as LLMProvider) || "google";
  const llmApiKey = process.env[`${HYP_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(`${HYP_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`);
  }

  const llmProvider = new LLM({
    apiKey: llmApiKey,
    name: HYP_LLM_PROVIDER,
  });

  const llmRequest = {
    maxTokens: options.maxTokens ?? 4000,
    messageId: options.messageId,
    messages: [
      {
        content: `Use the following evidence set to formulate a hypothesis: ${documentText}`,
        role: "assistant" as const,
      },
      {
        content: hypGenInstruction,
        role: "user" as const,
      },
    ],
    model,
    thinkingBudget: options.thinking ? (options.thinkingBudget ?? 2048) : undefined,
    usageType: options.usageType,
  };

  try {
    const response = await llmProvider.createChatCompletion(llmRequest);

    // Parse JSON if needed
    let finalText = response.content;
    try {
      finalText = JSON.parse(
        response.content.replace(/```json\n?/, "").replace(/\n?```$/, "")
      ).message;
    } catch {
      // Keep raw text if not JSON
    }

    logger.info(
      {
        docCount: documents.length,
        hypothesisLength: finalText.length,
        mode,
      },
      "hypothesis_generated"
    );

    return {
      text: finalText,
      thought: undefined, // TODO: Extract thinking if available from response
    };
  } catch (error) {
    logger.error({ error, mode }, "hypothesis_generation_failed");
    throw error;
  }
}
