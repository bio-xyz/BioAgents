import character from "../../character";
import {
  getMessagesByConversation,
  updateMessage,
  updateState,
} from "../../db/operations";
import { LLM } from "../../llm/provider";
import type { LLMResponse, LLMTool, WebSearchResponse } from "../../llm/types";
import { type Message, type Paper, type State } from "../../types/core";
import logger from "../../utils/logger";
import {
  addVariablesToState,
  cleanWebSearchResults,
  composePromptFromState,
  formatConversationHistory,
  getUniquePapers,
} from "../../utils/state";

type ProviderWebSearchResult = {
  title: string;
  url: string;
  originalUrl: string;
  index: number;
};

function selectTemplateKey(
  state: {
    values: {
      finalPapers?: unknown[] | null;
      openScholarPapers?: unknown[] | null;
    };
  },
  source: string,
):
  | "twitterReplyTemplateWeb"
  | "replyTemplateWeb"
  | "twitterReplyTemplate"
  | "replyTemplate" {
  const hasPapers =
    Boolean(state.values.finalPapers?.length) ||
    Boolean(state.values.openScholarPapers?.length);

  const isTwitter = source === "twitter";

  // Four-case matrix per your rules
  if (!hasPapers && isTwitter) return "twitterReplyTemplateWeb";
  if (!hasPapers && !isTwitter) return "replyTemplateWeb";
  if (hasPapers && isTwitter) return "twitterReplyTemplate";
  return "replyTemplate";
}

export const replyTool = {
  name: "REPLY",
  description: "Reply to the user's message based on the agent flow",
  execute: async (input: { state: State; message: Message }) => {
    const { state, message } = input;
    addVariablesToState(state, { currentStep: "REPLYING" });
    const source = state.values.source;

    let prompt = "";
    // auto tool choice by default
    const tools: LLMTool[] = [];

    let templateKey = selectTemplateKey(state, source || "");
    let template = character.templates[templateKey]!;

    logger.info(`Selected template: ${templateKey}`);

    let providerString =
      "You have access to the following chunks from your different knowledge bases. You should use these to answer the user's question if they are relevant to the user's question:\n";

    if (state.values.knowledge?.length) {
      // Create a concatenated string of knowledge for prompts
      const knowledgeString = state.values.knowledge
        .map(
          (doc: any, index: number) =>
            `[${index + 1}] ${doc.title} - ${doc.content}`,
        )
        .join("\n\n");

      providerString += `Knowledge chunks (from Aubrey De Grey's knowledge base): ${knowledgeString}\n`;
    }

    if (state.values.openScholarRaw?.length) {
      // each paper is of type {doi: string, title: string, chunkText: string}
      providerString += `Science papers (from OpenScholar Scientific RAG system): ${state.values.openScholarRaw.map((paper: Paper) => `${paper.doi} - ${paper.title} - Abstract/Chunk: ${paper.chunkText}`).join("\n\n")}`;
    }

    if (state.values.finalPapers?.length) {
      // each paper is of type {doi: string, title: string, abstract: string}
      providerString += `Science papers (from Knowledge Graph): ${state.values.finalPapers.map((paper: Paper) => `${paper.doi} - ${paper.title} - ${paper.abstract}`).join("\n")}`;
    }

    prompt = composePromptFromState(state, template);

    // Include conversation history
    let conversationHistory: any[] = [];
    if (source === "ui") {
      // Fetch last 5 DB messages (= 10 actual messages: 5 questions + 5 responses)
      try {
        conversationHistory = await getMessagesByConversation(
          message.conversation_id,
          5,
        );
        // Reverse to get chronological order (oldest first)
        conversationHistory = conversationHistory.reverse();
      } catch (err) {
        logger.warn({ err }, "failed_to_fetch_conversation_history");
      }
    } else if (source === "twitter") {
      // TODO: fetch twitter thread
      conversationHistory = [];
    }

    // Add conversation history to prompt if available
    // Each DB message contains both user question and assistant response
    if (conversationHistory.length > 0) {
      const historyText = formatConversationHistory(conversationHistory);
      prompt += `\n\nPrevious conversation:\n${historyText}\n`;
    }

    prompt += `\n\nYou need to reply to the following question:\n${message.question}`;

    const useWebSearch = templateKey.toLowerCase().includes("web");
    if (useWebSearch) {
      tools.push({ type: "webSearch" });
    }

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
    let googleLLMProvider: LLM;
    // default to google in case of error
    if (process.env.GOOGLE_API_KEY) {
      googleLLMProvider = new LLM({
        name: "google",
        apiKey: process.env.GOOGLE_API_KEY,
      });
    }
    let systemInstruction: string | undefined = undefined;
    if (character.system) {
      systemInstruction = character.system;
    }

    const messages = [
      {
        role: "assistant" as const,
        content: providerString,
      },
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    const llmRequest = {
      model: REPLY_LLM_MODEL,
      systemInstruction,
      messages,
      maxTokens: 768, // openai counts maxtokens = replyTokens + thinkingBudget
      thinkingBudget: 4096,
      tools: tools.length > 0 ? tools : undefined,
    };

    logger.info(`Provider string: ${providerString}\nFinal prompt: ${prompt}`);
    let finalText = "";
    let evalText = "";
    let webSearchResults: ProviderWebSearchResult[] = [];
    let thoughtText = "";

    if (useWebSearch) {
      let webResponse: WebSearchResponse;
      try {
        webResponse =
          await llmProvider.createChatCompletionWebSearch(llmRequest);
      } catch (error) {
        logger.error(
          `Failed to create chat completion web search with ${REPLY_LLM_PROVIDER}, defaulting to google:`,
          error as any,
        );
        const googleLLMRequest = {
          model: "gemini-2.5-pro",
          systemInstruction,
          messages,
          maxTokens: 768,
          thinkingBudget: 4096,
          tools: tools.length > 0 ? tools : undefined,
        };
        webResponse =
          await googleLLMProvider!.createChatCompletionWebSearch(
            googleLLMRequest,
          );
      }

      evalText = webResponse.llmOutput;
      finalText = webResponse.cleanedLLMOutput || webResponse.llmOutput;
      webSearchResults = webResponse.webSearchResults ?? [];

      // Only add additional sources if source is twitter
      // if (webSearchResults.length > 0 && source === "twitter") {
      //   const sourcesList = webSearchResults
      //     .map((result) => result.url)
      //     .join("\n");
      //   if (sourcesList) {
      //     finalText += `\n\nAdditional sources:\n${sourcesList}`;
      //   }
      // }
    } else {
      let completion: LLMResponse;
      try {
        completion = await llmProvider.createChatCompletion(llmRequest);
      } catch (error) {
        console.error(
          `Failed to create chat completion with ${REPLY_LLM_PROVIDER}, defaulting to google:`,
          error,
        );
        const googleLLMRequest = {
          model: "gemini-2.5-pro",
          systemInstruction,
          messages,
          maxTokens: 768,
          thinkingBudget: 4096,
          tools: tools.length > 0 ? tools : undefined,
        };
        completion =
          await googleLLMProvider!.createChatCompletion(googleLLMRequest);
      }

      console.log("Temporary completion: ", completion);
      const rawContent = completion.content?.trim();

      if (!rawContent) {
        throw new Error(`${REPLY_LLM_PROVIDER} LLM returned empty response.`);
      }

      try {
        finalText = JSON.parse(
          rawContent.replace(/```json\n?/, "").replace(/\n?```$/, ""),
        ).message;
      } catch (error) {
        logger.warn(
          `Failed to parse ${REPLY_LLM_PROVIDER} response as JSON, returning raw text.`,
        );
        finalText = rawContent;
      }

      evalText = finalText;
    }

    // TODO: POI logic goes here
    // TODO: if source is twitter, add shortened science papers to the final answer

    logger.info(
      `Found ${webSearchResults.length} web search results via ${REPLY_LLM_PROVIDER} provider`,
    );

    const uniquePapers = getUniquePapers(state);
    const cleanedWebSearchResults = cleanWebSearchResults(webSearchResults);

    addVariablesToState(state, {
      webSearchResults: cleanedWebSearchResults,
      thought: thoughtText,
    });

    const responseContent = {
      thought: thoughtText,
      text: finalText || "",
      actions: ["REPLY"],
      papers: uniquePapers,
      webSearchResults: cleanedWebSearchResults,
    };

    // Update message and state in DB
    if (message.id) {
      try {
        await updateMessage(message.id, {
          content: evalText,
        });
      } catch (err) {
        logger.error({ err }, "failed_to_update_message");
      }
    }

    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        logger.error({ err }, "failed_to_update_state");
      }
    }

    addVariablesToState(state, { currentStep: "DONE" });

    return responseContent;
  },
};
