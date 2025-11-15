import character from "../../character";
import { LLM, createLLMProvider } from "../../llm/provider";
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

    const PLANNING_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "featherless";
    
    // Debug: Log environment variables (including all LLM-related env vars)
    console.log(`[PLANNING] Environment variables:`, {
      PLANNING_LLM_PROVIDER: process.env.PLANNING_LLM_PROVIDER,
      PLANNING_LLM_MODEL: process.env.PLANNING_LLM_MODEL,
      REPLY_LLM_MODEL: process.env.REPLY_LLM_MODEL,
      HYP_LLM_MODEL: process.env.HYP_LLM_MODEL,
      STRUCTURED_LLM_MODEL: process.env.STRUCTURED_LLM_MODEL,
      FEATHERLESS_API_KEY: process.env.FEATHERLESS_API_KEY ? "***SET***" : "NOT SET",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "***SET***" : "NOT SET",
    });
    
    logger.info({
      PLANNING_LLM_PROVIDER: PLANNING_LLM_PROVIDER,
      PLANNING_LLM_PROVIDER_ENV: process.env.PLANNING_LLM_PROVIDER,
      PLANNING_LLM_MODEL_ENV: process.env.PLANNING_LLM_MODEL,
    }, "[PLANNING] Environment configuration");
    
    // Use helper function to create provider (handles Featherless baseUrl automatically)
    const providerConfig = createLLMProvider(PLANNING_LLM_PROVIDER);
    
    // Debug: Log provider configuration
    logger.info({
      providerName: providerConfig.name,
      baseUrl: providerConfig.baseUrl,
      hasApiKey: !!providerConfig.apiKey,
    }, "[PLANNING] Provider configuration");
    
    const planningLlmProvider = new LLM(providerConfig);

    const planningModel = process.env.PLANNING_LLM_MODEL || "meta-llama/Meta-Llama-3.1-8B-Instruct";
    
    // Debug: Log model configuration
    logger.info({
      planningModel,
      PLANNING_LLM_MODEL_ENV: process.env.PLANNING_LLM_MODEL,
      usingDefault: !process.env.PLANNING_LLM_MODEL,
    }, "[PLANNING] Model configuration");
    
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

    // Debug: Log the actual request being made
    logger.info({
      model: llmRequest.model,
      provider: PLANNING_LLM_PROVIDER,
      baseUrl: providerConfig.baseUrl,
      messageCount: llmRequest.messages.length,
      maxTokens: llmRequest.maxTokens,
    }, "[PLANNING] LLM request details");

    let lastError: Error | null = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        // Debug: Log attempt
        logger.info({
          attempt: i + 1,
          maxRetries: MAX_RETRIES,
          model: llmRequest.model,
        }, "[PLANNING] Attempting LLM call");
        
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
