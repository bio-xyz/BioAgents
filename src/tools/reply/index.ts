import character from "../../character";
import {
  getMessagesByConversation,
  updateMessage,
  updateState,
} from "../../db/operations";
import { LLM } from "../../llm/provider";
import type { LLMResponse, LLMTool, WebSearchResponse } from "../../llm/types";
import {
  type ConversationState,
  type Message,
  type Paper,
  type State,
} from "../../types/core";
import logger from "../../utils/logger";
import {
  addVariablesToState,
  cleanWebSearchResults,
  composePromptFromState,
  endStep,
  formatConversationHistory,
  getUniquePapers,
  startStep,
} from "../../utils/state";
import { detectFileTypes } from "./fileDetection";
import {
  addParsedFilesToContext,
  configureToolsForFiles,
  uploadFilesToGemini,
} from "./fileHandler";
import { getFileAnalysisPrompt } from "./prompts";

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
      semanticScholarPapers?: unknown[] | null;
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
    Boolean(state.values.openScholarPapers?.length) ||
    Boolean(state.values.semanticScholarPapers?.length);

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
  enabled: true,
  execute: async (input: {
    state: State;
    conversationState?: ConversationState;
    message: Message;
  }) => {
    const { state, conversationState, message } = input;
    startStep(state, "REPLY");

    // Update state in DB after startStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        logger.error({ err }, "failed_to_update_state");
      }
    }

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

    if (state.values.semanticScholarSynthesis) {
      // Semantic Scholar synthesis is a text string with synthesized research findings (papers extracted separately)
      providerString += `\n\nResearch synthesis (from Semantic Scholar via Claude Skill):\n${state.values.semanticScholarSynthesis}\n`;
    }

    if (state.values.semanticScholarPapers?.length) {
      // each paper is of type {doi: string (URL), title: string, abstract: string (empty)}
      providerString += `\n\nScience papers (from Semantic Scholar): ${state.values.semanticScholarPapers.map((paper: Paper) => `${paper.doi} - ${paper.title}`).join("\n")}`;
    }

    if (state.values.finalPapers?.length) {
      // each paper is of type {doi: string, title: string, abstract: string}
      providerString += `\n\nScience papers (from Knowledge Graph): ${state.values.finalPapers.map((paper: Paper) => `${paper.doi} - ${paper.title} - ${paper.abstract}`).join("\n")}`;
    }

    if (conversationState?.values.papers?.length) {
      providerString += `\n\nMost important science papers (from the current conversation history): ${conversationState.values.papers.map((paper: Paper) => `${paper.doi} - ${paper.title} - ${paper.abstract}`).join("\n")}`;
    }

    if (conversationState?.values.keyInsights?.length) {
      providerString += `\n\nKey insights (from the current conversation history): ${conversationState.values.keyInsights.map((insight: string) => `${insight}`).join("\n")}`;
    }

    if (conversationState?.values.methodology) {
      providerString += `\n\nMethodology (from the current conversation history): ${conversationState.values.methodology}`;
    }

    // For non-Google providers, add parsed text to context now
    // For Google, we'll upload files to Gemini File API after provider initialization

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

    // Detect file types and add appropriate analysis instructions
    const fileTypes = detectFileTypes(state.values.rawFiles);
    const fileAnalysisPrompt = getFileAnalysisPrompt(
      fileTypes.hasPDF,
      fileTypes.hasDataFile,
      fileTypes.hasImage,
    );
    if (fileAnalysisPrompt) {
      prompt += fileAnalysisPrompt;
    }

    const REPLY_LLM_PROVIDER = process.env.REPLY_LLM_PROVIDER!;
    const REPLY_LLM_MODEL = process.env.REPLY_LLM_MODEL!;

    // Configure tools based on file types and provider
    const toolConfig = configureToolsForFiles(
      templateKey,
      REPLY_LLM_PROVIDER,
      REPLY_LLM_MODEL,
      state,
    );
    tools.push(...toolConfig.tools);
    const useWebSearch = toolConfig.useWebSearch;

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

    // Handle file uploads for Google vs other providers
    // Currently only Google Gemini supports native file upload via File API
    // TODO: Support file upload for other LLM providers
    // For now, other providers receive parsed text content as fallback
    let geminiFileUris: Array<{ fileUri: string; mimeType: string }> = [];

    if (state.values.rawFiles?.length && REPLY_LLM_PROVIDER === "google") {
      const googleAdapter = (llmProvider as any).adapter as any;
      geminiFileUris = await uploadFilesToGemini(state, googleAdapter);
    }

    // For non-Google providers or as fallback, add parsed text to context
    if (state.values.rawFiles?.length && geminiFileUris.length === 0) {
      providerString = addParsedFilesToContext(state, providerString);
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

    state.values.finalResponse = "";

    const llmRequest = {
      model: REPLY_LLM_MODEL,
      systemInstruction,
      messages,
      maxTokens: 4096, // openai counts maxtokens = replyTokens + thinkingBudget
      thinkingBudget: 1024,
      tools: tools.length > 0 ? tools : undefined,
      // Pass fileUris to adapter so it can add them as fileData parts in message
      fileUris: geminiFileUris.length > 0 ? geminiFileUris : undefined,
      stream: true,
      onStreamChunk: async (chunk: string, fullText: string) => {
        // Update state with the full text (not just the chunk)
        state.values.finalResponse = fullText;

        // Update state in DB
        if (state.id) {
          await updateState(state.id, state.values);
        }
      },
    };

    const contextLength = providerString.length + prompt.length;
    logger.info(`📊 LLM Context Stats:`);
    logger.info(`   - Provider context: ${providerString.length} characters`);
    logger.info(`   - Prompt: ${prompt.length} characters`);
    logger.info(`   - Total context: ${contextLength} characters`);
    logger.info(`   - Model: ${REPLY_LLM_MODEL}`);
    logger.info(`   - Using web search: ${useWebSearch}`);

    let finalText = "";
    let evalText = "";
    let webSearchResults: ProviderWebSearchResult[] = [];
    let thoughtText = "";

    logger.info(`🤖 Sending request to ${REPLY_LLM_PROVIDER}...`);

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

      logger.info(`✅ Received response from ${REPLY_LLM_PROVIDER}`);
      logger.info(`   - Response length: ${finalText.length} characters`);
      logger.info(`   - Web search results: ${webSearchResults.length}`);

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

      logger.info(`✅ Received response from ${REPLY_LLM_PROVIDER}`);
      logger.info(`   - Response length: ${finalText.length} characters`);
    }

    // TODO: if source is twitter, add shortened science papers to the final answer

    logger.info(
      `Found ${webSearchResults.length} web search results via ${REPLY_LLM_PROVIDER} provider`,
    );

    const uniquePapers = getUniquePapers(state);
    const cleanedWebSearchResults = cleanWebSearchResults(webSearchResults);

    addVariablesToState(state, {
      finalResponse: finalText,
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

    // Update message in DB
    if (message.id) {
      try {
        await updateMessage(message.id, {
          content: evalText,
        });
      } catch (err) {
        logger.error({ err }, "failed_to_update_message");
      }
    }

    endStep(state, "REPLY");

    // Update state in DB after endStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        logger.error({ err }, "failed_to_update_state");
      }
    }

    return responseContent;
  },
};
