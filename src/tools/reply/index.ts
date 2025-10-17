import { type State, type Message } from "../../types/core";
import { LLM } from "../../llm/provider";

export const replyTool = {
  name: "REPLY",
  description: "Reply to the user's message based on the agent flow",
  execute: async (input: { state: State; message: Message }) => {
    // TODO: implement actual logic for replying instead of this dummy implementation
    const { state, message } = input;

    const openScholarPapers = state.values.openScholarRaw.map((paper: any) => ({
      ...paper,
      abstract: paper.chunkText,
    }));

    const replyPrompt = `Based on the following OpenScholar papers:
    
    ${openScholarPapers.map((paper: any) => `${paper.title}, ${paper.doi}: ${paper.abstract}`).join("\n\n")}
    
    Reply to the user's message: ${message.content.text}`;

    const REPLY_LLM_PROVIDER = process.env.REPLY_LLM_PROVIDER!;
    const REPLY_LLM_MODEL = process.env.REPLY_LLM_MODEL!;
    const llmApiKey =
      process.env[`${REPLY_LLM_PROVIDER.toUpperCase()}_API_KEY`];
    if (!llmApiKey) {
      throw new Error(
        `${REPLY_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
      );
    }

    const llmProvider = new LLM({
      // @ts-ignore
      name: REPLY_LLM_PROVIDER,
      apiKey: llmApiKey,
    });

    const llmRequest = {
      model: REPLY_LLM_MODEL,
      messages: [
        {
          role: "user" as const,
          content: replyPrompt,
        },
      ],
      maxTokens: 2768,
      thinkingBudget: 2048,
    };

    const llmResponse = await llmProvider.createChatCompletion(llmRequest);

    return {
      text: llmResponse.content,
    };
  },
};
