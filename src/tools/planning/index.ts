import character from "../../character";
import { LLM } from "../../llm/provider";
import { type Message, type State, type Tool } from "../../types/core";
import logger from "../../utils/logger";
import {
  composePromptFromState,
  formatConversationHistory,
  parseKeyValueXml,
  startStep,
  endStep,
} from "../../utils/state";
import { getMessagesByConversation } from "../../db/operations";
import { calculateRequestPrice } from "../../x402/pricing";

export const planningTool: Tool = {
  name: "PLANNING",
  description: "Plan the agent workflow execution",
  enabled: true,
  execute: async (input: {
    state: State;
    message: Message;
  }): Promise<{ providers: string[]; actions: string[] }> => {
    const { state, message } = input;

    startStep(state, "PLANNING");

    // Update state in DB after startStep
    if (state.id) {
      try {
        console.log('[planning] Updating state after startStep, state.id:', state.id, 'steps:', state.values.steps);
        const { updateState } = await import("../../db/operations");
        await updateState(state.id, state.values);
        console.log('[planning] State updated successfully');
      } catch (err) {
        console.error("Failed to update state in DB:", err);
      }
    } else {
      console.warn('[planning] No state.id available, skipping state update');
    }

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

    let lastError: Error | null = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const completion =
          await planningLlmProvider.createChatCompletion(llmRequest);
        const xmlResponseText = completion.content;

        logger.info(`Planning LLM response: ${xmlResponseText}`);

        const parsedXmlResponse = parseKeyValueXml(xmlResponseText);
        if (!parsedXmlResponse) {
          throw new Error("Failed to parse XML response from planning LLM");
        }

        const providersRaw = parsedXmlResponse.providers;
        const providerList = Array.isArray(providersRaw)
          ? providersRaw
          : typeof providersRaw === "string"
          ? providersRaw
              .split(",")
              .map((p: string) => p.trim())
              .filter(Boolean)
          : [];

        const actionsRaw = parsedXmlResponse.actions;
        const actionList = Array.isArray(actionsRaw)
          ? actionsRaw
          : typeof actionsRaw === "string"
          ? actionsRaw
              .split(",")
              .map((a: string) => a.trim())
              .filter(Boolean)
          : [];

        // Initialize estimatedCostsUSD object if it doesn't exist
        if (!state.values.estimatedCostsUSD) {
          state.values.estimatedCostsUSD = {};
        }

        // Store estimated cost for PLANNING tool specifically
        const planningCost = calculateRequestPrice(["PLANNING"]);
        state.values.estimatedCostsUSD["PLANNING"] = parseFloat(planningCost);

        endStep(state, "PLANNING");

        // Update state in DB after endStep
        if (state.id) {
          try {
            const { updateState } = await import("../../db/operations");
            await updateState(state.id, state.values);
          } catch (err) {
            console.error("Failed to update state in DB:", err);
          }
        }

        return {
          providers: providerList,
          actions: actionList,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const attemptNum = i + 1;
        logger.warn(
          {
            attempt: attemptNum,
            maxRetries: MAX_RETRIES,
            provider: PLANNING_LLM_PROVIDER,
            error: lastError.message,
          },
          `Planning LLM call failed (attempt ${attemptNum}/${MAX_RETRIES})`,
        );
        
        // If this is the last attempt, don't continue the loop
        if (i === MAX_RETRIES - 1) {
          break;
        }
      }
    }

    // All retries failed - throw a descriptive error
    endStep(state, "PLANNING");

    // Update state in DB after endStep
    if (state.id) {
      try {
        const { updateState } = await import("../../db/operations");
        await updateState(state.id, state.values);
      } catch (err) {
        console.error("Failed to update state in DB:", err);
      }
    }

    const errorMessage = lastError
      ? `Planning LLM failed after ${MAX_RETRIES} attempts: ${lastError.message}`
      : `Planning LLM failed after ${MAX_RETRIES} attempts: Unknown error`;
    throw new Error(errorMessage);
  },
};
