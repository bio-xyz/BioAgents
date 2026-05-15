import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export async function generateFallbackReply(
  userMessage: string,
  systemPrompt: string,
  conversationHistory: MessageParam[]
): Promise<string | null> {
  const logger = (await import("../utils/logger")).default;
  const { LLM } = await import("../llm/provider");
  const { parseLLMProviderName } = await import("../llm/types");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error("fallback_reply_no_openai_key");
    return null;
  }

  try {
    const llm = new LLM({
      apiKey,
      name: parseLLMProviderName("openai"),
    });

    const messages = [
      ...conversationHistory.map((m) => ({
        content: typeof m.content === "string" ? m.content : "",
        role: m.role as "user" | "assistant",
      })),
      { content: userMessage, role: "user" as const },
    ];

    const response = await llm.createChatCompletion({
      maxTokens: 4096,
      messages,
      model: process.env.FALLBACK_LLM_MODEL || "gpt-5.4",
      systemInstruction: systemPrompt,
      temperature: 0.3,
      usageType: "chat",
    });

    return response.content?.trim() || null;
  } catch (err) {
    logger.error({ error: err }, "fallback_reply_failed");
    return null;
  }
}
