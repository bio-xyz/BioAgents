import {
  updateMessage,
  updateState,
  type ConversationState,
} from "../../db/operations";
import { type Message, type State } from "../../types/core";
import logger from "../../utils/logger";
import { addVariablesToState, endStep, startStep } from "../../utils/state";
import {
  generateHypothesis,
  type HypothesisDoc,
  type WebSearchResults,
} from "./utils";

export const hypothesisTool = {
  name: "HYPOTHESIS",
  description: "Reply to the user's message based on the agent flow",
  enabled: true,
  execute: async (input: {
    state: State;
    conversationState?: ConversationState;
    message: Message;
  }) => {
    const { state, conversationState, message } = input;
    // let hypothesisStructured: THypothesisZod | null = null;

    startStep(state, "HYPOTHESIS");

    // Update state in DB after startStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        logger.error({ err }, "failed_to_update_state");
      }
    }

    // TODO: get twitter thread if source is twitter

    const openScholarPapers = state.values.openScholarRaw?.map(
      (paper: any) => ({
        ...paper,
        abstract: paper.chunkText,
      }),
    );
    // TODO: add actual KG papers
    const kgPapers: any[] = state.values.kgPapers || [];

    const conversationPapers = conversationState?.values.papers || [];

    const allPapers = [
      ...(openScholarPapers || []),
      ...(kgPapers || []),
      ...(conversationPapers || []),
    ];

    let hypDocs: HypothesisDoc[] = allPapers.map((paper) => ({
      title: `${paper.doi} - ${paper.title}`,
      text: paper.abstract,
      context: "This chunk is from OpenScholar RAG on longevity and aging",
    }));

    // add top 3 knowledge chunks to hypDocs too
    const knowledgeChunks = (state.values.knowledge || []).slice(0, 3);
    knowledgeChunks.forEach((chunk: any) => {
      hypDocs.push({
        title: chunk.title,
        text: chunk.content,
        context: "This chunk is from Aubrey De Grey's knowledge base",
      });
    });

    // add conversation key insights & methodology & title as one chunk to hypDocs
    if (conversationState?.values.keyInsights?.length) {
      hypDocs.push({
        title: conversationState.values.conversationTitle || "No title",
        text: `Conversation Title: ${conversationState.values.conversationTitle || "No title"}\nConversation Goal: ${conversationState.values.conversationGoal || "No goal"}\nMethodology: ${conversationState.values.methodology || "No methodology"}\nKey Insights: ${conversationState.values.keyInsights.join("\n")}`,
        context: "This chunk is from the current conversation history",
      });
    }

    if (hypDocs.length == 0) {
      logger.info(
        "No relevant docs found in both KG and openscholar for hyp gen, falling back to web search",
      );
    } else {
      logger.info(
        `Using hyp docs: ${hypDocs.map((doc) => `${doc.title} - ${doc.text.slice(0, 100)}...`).join(", ")}`,
      );
    }

    const useWebSearch = hypDocs.length == 0;
    const question = message.question!;
    let webSearchResults: WebSearchResults[] = [];

    // Initialize finalResponse in state
    state.values.finalResponse = "";

    try {
      logger.info(`Generating hypothesis with streaming`);
      const {
        text,
        thought,
        webSearchResults: hypWebSearchResults,
      } = await generateHypothesis(question, hypDocs, {
        maxTokens: 5500,
        thinking: true,
        thinkingBudget: 2500,
        useWebSearch,
        stream: true,
        onStreamChunk: async (_chunk: string, fullText: string) => {
          // Update state with the full text as hypothesis streams
          state.values.finalResponse = fullText;
          state.values.hypothesis = fullText;

          // Update state in DB
          if (state.id) {
            await updateState(state.id, state.values);
          }
        },
      });

      webSearchResults = hypWebSearchResults;
      logger.info(`Web search results: ${JSON.stringify(webSearchResults)}`);
      state.values.hypothesis = text;
      state.values.hypothesisThought = thought;
      state.values.finalResponse = text;

      // logger.info(`Converting hypothesis to structured format`);
      // hypothesisStructured = await structured(state.values.hypothesis);
      // logger.info(`Hyp: ${JSON.stringify(hypothesisStructured, null, 2)}`);
      // TODO: logger.info(`Inserting hypothesis into KG`);
      // insert hypothesis into KG
    } catch (err) {
      console.error("Error running hypothesis generation", err);
    }

    const finalText = {
      finalText: state.values.hypothesis || "",
      thought: state.values.hypothesisThought as string,
      webSearchResults,
    };

    // TODO: if source is twitter, create a POI

    // if (
    //   hypothesisStructured?.supportingPapers &&
    //   hypothesisStructured?.supportingPapers.length &&
    //   !useWebSearch
    // ) {
    //   finalText.finalText += `\n\n\n\nScience papers:\n${hypothesisStructured?.supportingPapers.join("\n")}`; // use only supporting papers
    // }
    // if (
    //   hypothesisStructured?.webSearchResults &&
    //   hypothesisStructured?.webSearchResults.length &&
    //   useWebSearch
    // ) {
    //   // TODO: if source is twitter, include Additional sources
    // }

    // Clean up web search result titles - if title is a URL, extract just the domain
    const cleanedWebSearchResults = webSearchResults.map((result) => {
      let cleanedTitle = result.title!;

      // Check if title looks like a URL
      if (
        cleanedTitle.startsWith("http://") ||
        cleanedTitle.startsWith("https://") ||
        cleanedTitle.startsWith("www.")
      ) {
        try {
          // Parse the URL to extract just the domain
          const urlToParse = cleanedTitle.startsWith("www.")
            ? `https://${cleanedTitle}`
            : cleanedTitle;
          const parsedUrl = new URL(urlToParse);
          cleanedTitle = parsedUrl.hostname.replace(/^www\./, "www.");

          // Ensure it starts with www.
          if (!cleanedTitle.startsWith("www.")) {
            cleanedTitle = "www." + cleanedTitle;
          }
        } catch {
          // If parsing fails, keep the original title
        }
      }

      return {
        ...result,
        title: cleanedTitle,
      };
    });

    // Extract DOI URLs and Semantic Scholar URLs from the raw hypothesis text
    const hypothesisText = state.values.hypothesis || "";

    // Match DOI URLs: https://doi.org/10.xxxx/xxxxx
    const doiRegex = /https?:\/\/doi\.org\/10\.\d+\/[^\s\)]+/gi;
    const extractedDOIs = [...hypothesisText.matchAll(doiRegex)].map(
      (match) => match[0],
    );

    // Match Semantic Scholar URLs: https://www.semanticscholar.org/paper/...
    const semanticScholarRegex =
      /https?:\/\/(?:www\.)?semanticscholar\.org\/paper\/[a-f0-9]+/gi;
    const extractedSemanticScholar = [
      ...hypothesisText.matchAll(semanticScholarRegex),
    ].map((match) => match[0]);

    const allExtractedURLs = [...extractedDOIs, ...extractedSemanticScholar];

    logger.info(
      `Extracted paper URLs from hypothesis: ${JSON.stringify(allExtractedURLs)}`,
    );

    // Filter papers to only include those that were actually referenced in the hypothesis
    const usedPapers = allPapers.filter((paper) => {
      // Check if paper.doi is in the extracted URLs
      return allExtractedURLs.some(
        (url) => paper.doi.includes(url) || url.includes(paper.doi),
      );
    });

    logger.info(`Used papers: ${JSON.stringify(usedPapers)}`);

    addVariablesToState(state, {
      finalResponse: finalText.finalText,
      thought: (state.values.hypothesisThought as string) ?? finalText.thought,
      webSearchResults: cleanedWebSearchResults,
    });

    const responseContent = {
      thought: (state.values.hypothesisThought as string) ?? finalText.thought,
      text: finalText.finalText || "",
      actions: ["HYPOTHESIS_GENERATION"],
      papers: usedPapers,
      webSearchResults: cleanedWebSearchResults,
    };

    // Update message in DB
    if (message.id) {
      try {
        await updateMessage(message.id, {
          content: responseContent.text,
        });
      } catch (err) {
        // Log error but don't fail the tool execution
        logger.error({ err }, "failed_to_update_message");
      }
    }

    endStep(state, "HYPOTHESIS");

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
