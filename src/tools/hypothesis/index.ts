import character from "../../character";
import { updateMessage } from "../../db/operations";
import { type Message, type State } from "../../types/core";
import logger from "../../utils/logger";
import { addVariablesToState, composePromptFromState } from "../../utils/state";
import type { THypothesisZod } from "./types";
import {
  generateFinalResponse,
  generateHypothesis,
  structured,
  type HypothesisDoc,
  type WebSearchResults,
} from "./utils";

export const hypothesisTool = {
  name: "HYPOTHESIS",
  description: "Reply to the user's message based on the agent flow",
  execute: async (input: { state: State; message: Message }) => {
    const { state, message } = input;
    let hypothesisStructured: THypothesisZod | null = null;

    // TODO: broadcast HYPOTHESIS_GENERATION state

    // TODO: get twitter thread if source is twitter

    const openScholarPapers = state.values.openScholarRaw.map((paper: any) => ({
      ...paper,
      abstract: paper.chunkText,
    }));
    // TODO: add actual KG papers
    const kgPapers: any[] = state.values.kgPapers || [];

    const allPapers = [...openScholarPapers, ...kgPapers];

    let hypDocs: HypothesisDoc[] = allPapers.map((paper) => ({
      title: `${paper.doi} - ${paper.title}`,
      text: paper.abstract,
      context: "This chunk is from OpenScholar RAG on longevity and aging",
    }));

    // add top 3 knowledge chunks to hypDocs too
    const knowledgeChunks = state.values.knowledge.slice(0, 3);
    knowledgeChunks.forEach((chunk: any) => {
      hypDocs.push({
        title: chunk.title,
        text: chunk.content,
        context: "This chunk is from Aubrey De Grey's knowledge base",
      });
    });

    if (hypDocs.length == 0) {
      logger.info(
        "No relevant docs found in both KG and openscholar for hyp gen, falling back to web search",
      );
    } else {
      logger.info(
        `Using hyp docs: ${hypDocs.map((doc) => doc.title).join(", ")}`,
      );
    }

    const useWebSearch = hypDocs.length == 0;
    const question = message.question!;
    let webSearchResults: WebSearchResults[] = [];
    try {
      logger.info(`Generating hypothesis`);
      const {
        text,
        thought,
        webSearchResults: hypWebSearchResults,
      } = await generateHypothesis(question, hypDocs, {
        maxTokens: 5500,
        stream: true,
        thinking: true,
        thinkingBudget: 2500,
        useWebSearch,
      });
      webSearchResults = hypWebSearchResults;
      logger.info(`Web search results: ${JSON.stringify(webSearchResults)}`);
      state.values.hypothesis = text;
      state.values.hypothesisThought = thought;
      logger.info(`Converting hypothesis to structured format`);
      hypothesisStructured = await structured(state.values.hypothesis);
      logger.info(`Hyp: ${JSON.stringify(hypothesisStructured, null, 2)}`);
      // TODO: logger.info(`Inserting hypothesis into KG`);
      // insert hypothesis into KG
    } catch (err) {
      console.error("Error running hypothesis generation", err);
    }

    let prompt = "";

    // TODO: if source is twitter, add twitter thread to prompt
    // otherwise just compose the prompt
    prompt = composePromptFromState(
      state,
      character.templates.hypothesisActionTemplate,
    );

    prompt += `\n\nYou need to reply to the following question:\n${message.question}`;

    logger.info(`Final prompt: ${prompt}`);

    logger.info(`Generating final response to sent to chat/twittter`);
    let finalText = await generateFinalResponse(prompt, webSearchResults);
    logger.info(`Generated final response to sent to chat/twittter`);

    // TODO: if source is twitter, create a POI

    if (
      hypothesisStructured?.supportingPapers &&
      hypothesisStructured?.supportingPapers.length &&
      !useWebSearch
    ) {
      finalText.finalText += `\n\n\n\nScience papers:\n${hypothesisStructured?.supportingPapers.join("\n")}`; // use only supporting papers
    }
    if (
      hypothesisStructured?.webSearchResults &&
      hypothesisStructured?.webSearchResults.length &&
      useWebSearch
    ) {
      // TODO: if source is twitter, include Additional sources
    }

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

    // Filter papers to only include those that were actually used in supporting papers
    const supportingPapers = hypothesisStructured?.supportingPapers ?? [];
    const usedPapers = allPapers.filter((paper) => {
      // Extract DOI from the URL (paper.doi is like "https://doi.org/10.1234/value")
      const doiMatch = paper.doi.match(/10\.\d+\/[^\s]+/);
      const doi = doiMatch ? doiMatch[0] : paper.doi;

      // Check if any supporting paper string includes this DOI
      return supportingPapers.some((supportingPaper) =>
        supportingPaper.includes(doi),
      );
    });

    addVariablesToState(state, {
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

    // Update message in DB with final msg text (content) and state
    if (message.id) {
      try {
        await updateMessage(message.id, {
          content: responseContent.text,
          state: state.values,
        });
      } catch (err) {
        // Log error but don't fail the tool execution
        logger.error({ err }, "failed_to_update_message");
      }
    }

    // broadcast messageState DONE

    return responseContent;
  },
};
