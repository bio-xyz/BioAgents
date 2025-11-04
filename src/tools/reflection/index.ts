import { updateConversationState, updateState } from "../../db/operations";
import { LLM } from "../../llm/provider";
import {
  type ConversationState,
  type Message,
  type State,
} from "../../types/core";
import logger from "../../utils/logger";
import { endStep, startStep } from "../../utils/state";
import { getReflectionPrompt } from "./prompts";

export const reflectionTool = {
  name: "REFLECTION",
  description:
    "Reflect on the agent's conversation and adapts the conversation state based on the conversation",
  enabled: true,
  execute: async (input: {
    state: State;
    conversationState: ConversationState;
    message: Message;
  }) => {
    const { state, conversationState, message } = input;

    // start step for reflection
    startStep(state, "REFLECTION");

    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        console.error("Failed to update state in DB:", err);
      }
    }

    const allPapersFromState = [
      ...(state.values.openScholarPapers || []),
      ...(state.values.semanticScholarPapers || []),
      ...(state.values.kgPapers || []),
    ];

    const hypothesis = state.values.hypothesis;

    // if conversation state is empty, then we will take everything related to the message state
    if (
      !conversationState ||
      !conversationState.values ||
      Object.keys(conversationState.values).length === 0
    ) {
      logger.info(
        "Conversation state is empty, taking everything related to the message state",
      );

      // we will take everything related to the message state
      conversationState.values = {
        ...conversationState.values,
        hypothesis,
        papers: allPapersFromState,
      };
    } else {
      // we need a prompt to reflect on the previous conversation state and the new message state
      const prompt = await getReflectionPrompt(state, conversationState, message);
      // temporary console logs
      logger.info(`Prompt: ${prompt}`);
      const response = await new LLM({
        name: "google",
        apiKey: process.env.GOOGLE_API_KEY!,
      }).createChatCompletion({
        model: "gemini-2.5-pro",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 1024,
        thinkingBudget: 2048,
      });
      // temporary console logs
      logger.info(`Response content: ${response.content}`);

      conversationState.values = {
        ...conversationState.values,
        ...JSON.parse(
          response.content.replace(/```json\n?/, "").replace(/\n?```$/, ""),
        ),
      };

      // temporary console logs
      logger.info(
        `New conversation state: ${JSON.stringify(conversationState.values)}`,
      );
    }

    // end step for reflection
    endStep(state, "REFLECTION");

    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        console.error("Failed to update state in DB:", err);
      }
    }

    if (conversationState.id) {
      try {
        await updateConversationState(
          conversationState.id,
          conversationState.values,
        );
      } catch (err) {
        console.error("Failed to update conversation state in DB:", err);
      }
    }
  },
};
