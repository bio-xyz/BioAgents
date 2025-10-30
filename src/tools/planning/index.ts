import character from "../../character";
import { LLM } from "../../llm/provider";
import { type Message, type State, type Tool } from "../../types/core";
import logger from "../../utils/logger";
import {
  composePromptFromState,
  formatConversationHistory,
  parseKeyValueXml,
} from "../../utils/state";
import { getMessagesByConversation } from "../../db/operations";

export const planningTool: Tool = {
  name: "PLANNING",
  description: "Plan the agent workflow execution",
  enabled: true,
  execute: async (input: {
    state: State;
    message: Message;
  }): Promise<{ providers: string[]; actions: string[] }> => {
    const { state, message } = input;

    // TODO: idea - instead of providers/actions use a less structured approach, outline steps in 'levels'
    const prompt = composePromptFromState(
      state,
      character.templates.planningTemplate,
    );

    const PLANNING_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "google";
    const planningApiKey =
      process.env[`${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY`];

    if (!planningApiKey) {
      throw new Error(
        `${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
      );
    }

    const planningLlmProvider = new LLM({
      // @ts-ignore
      name: PLANNING_LLM_PROVIDER,
      apiKey: planningApiKey,
    });

    const planningModel = process.env.PLANNING_LLM_MODEL || "gemini-2.5-pro";
    // planning is the most important part, so we'll make sure to try 3 times to get it right
    const MAX_RETRIES = 3;

    // Fetch conversation history (last 3 DB messages = 6 actual messages)
    let conversationHistory: any[] = [];
    try {
      conversationHistory = await getMessagesByConversation(
        message.conversation_id,
        3,
      );
      // Reverse to get chronological order (oldest first)
      conversationHistory = conversationHistory.reverse();
    } catch (err) {
      logger.warn({ err }, "failed_to_fetch_conversation_history");
    }

    // Format conversation history
    let historyText = "";
    if (conversationHistory.length > 0) {
      const formattedHistory = formatConversationHistory(conversationHistory);
      historyText = `\n\nPrevious conversation:\n${formattedHistory}\n`;
    }

    const messages = [
      {
        role: "assistant" as const,
        content: prompt,
      },
      {
        role: "user" as const,
        content: `${historyText}\n\nUser message to evaluate: ${message.question}`,
      },
    ];

    const llmRequest = {
      model: planningModel,
      messages,
      maxTokens: 1024,
    };

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const completion =
          await planningLlmProvider.createChatCompletion(llmRequest);
        const xmlResponseText = completion.content;

        logger.info(`Planning LLM response: ${xmlResponseText}`);

        const parsedXmlResponse = parseKeyValueXml(xmlResponseText);
        if (!parsedXmlResponse) {
          throw new Error("Failed to parse XML response");
        }

        const { actions, providers } = parsedXmlResponse;
        return {
          providers,
          actions,
        };
      } catch (error) {
        console.error(
          `Failed to create chat completion with ${PLANNING_LLM_PROVIDER}, retrying...`,
          error,
        );
      }
    }

    // planning LLM failed, return empty arrays
    return {
      providers: [],
      actions: [],
    };
  },
};
