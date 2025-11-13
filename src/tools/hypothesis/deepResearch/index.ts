import { updateState } from "../../../db/operations";
import {
  type ConversationState,
  type Message,
  type State,
} from "../../../types/core";
import logger from "../../../utils/logger";
import { endStep, startStep } from "../../../utils/state";
import { generateHypothesis, type HypothesisDoc } from "../utils";

export const hypothesisDeepResearchTool = {
  name: "HYPOTHESIS_DEEP_RESEARCH",
  description:
    "Generate a scientific hypothesis for deep research based on gathered literature",
  enabled: true,
  deepResearchEnabled: true,
  execute: async (input: {
    state: State;
    conversationState?: ConversationState;
    message: Message;
  }) => {
    const { state, conversationState, message } = input;

    startStep(state, "HYPOTHESIS_DEEP_RESEARCH");

    // Update state in DB after startStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        logger.error({ err }, "failed_to_update_state");
      }
    }

    // Gather papers from various sources
    const openScholarPapers = state.values.openScholarRaw?.map(
      (paper: any) => ({
        ...paper,
        abstract: paper.chunkText,
      }),
    );

    const semanticScholarPapers = state.values.semanticScholarPapers || [];
    const finalPapers = state.values.finalPapers || [];
    const conversationPapers = conversationState?.values.papers || [];

    const allPapers = [
      ...(openScholarPapers || []),
      ...(semanticScholarPapers || []),
      ...(finalPapers || []),
      ...(conversationPapers || []),
    ];

    logger.info(
      { paperCount: allPapers.length },
      "gathered_papers_for_hypothesis",
    );

    // Build hypothesis documents
    let hypDocs: HypothesisDoc[] = allPapers.map((paper) => ({
      title: `${paper.doi} - ${paper.title}`,
      text: paper.abstract || paper.chunkText || "",
      context: "Scientific paper from literature search",
    }));

    // Add top 3 knowledge chunks
    const knowledgeChunks = (state.values.knowledge || []).slice(0, 3);
    knowledgeChunks.forEach((chunk: any) => {
      hypDocs.push({
        title: chunk.title,
        text: chunk.content,
        context: "This chunk is from Aubrey De Grey's knowledge base",
      });
    });

    // Add conversation context if available
    if (conversationState?.values.keyInsights?.length) {
      hypDocs.push({
        title: conversationState.values.conversationTitle || "No title",
        text: `Conversation Title: ${conversationState.values.conversationTitle || "No title"}\nConversation Goal: ${conversationState.values.conversationGoal || "No goal"}\nMethodology: ${conversationState.values.methodology || "No methodology"}\nKey Insights: ${conversationState.values.keyInsights.join("\n")}`,
        context: "This chunk is from the current conversation history",
      });
    }

    // Add Semantic Scholar synthesis if available
    if (state.values.semanticScholarSynthesis) {
      hypDocs.push({
        title: "Semantic Scholar Research Synthesis",
        text: state.values.semanticScholarSynthesis,
        context: "Synthesized research findings from Semantic Scholar",
      });
    }

    // Add Edison LITERATURE results if available
    if (state.values.edisonResults?.length) {
      state.values.edisonResults
        .filter((result: any) => result.jobType === "LITERATURE")
        .forEach((result: any) => {
          if (result.answer) {
            hypDocs.push({
              title: "Edison Literature",
              text: result.answer,
              context: "Edison AI literature search result",
            });
          }
        });
    }

    if (hypDocs.length === 0) {
      logger.warn("No relevant docs found for hypothesis generation");
      throw new Error("No literature available for hypothesis generation");
    }

    logger.info(
      {
        docCount: hypDocs.length,
        sources: hypDocs.map((doc) => doc.title),
      },
      "using_hypothesis_docs",
    );

    const question = message.question!;

    try {
      logger.info("Generating hypothesis for deep research");

      const { text, thought } = await generateHypothesis(question, hypDocs, {
        maxTokens: 4000,
        thinking: true,
        thinkingBudget: 2048,
        useWebSearch: false, // Deep research uses gathered literature, not web search
        isDeepResearch: true, // Use deep research prompt
        noveltyImprovement: state.values.noveltyImprovement, // Pass novelty improvement if available
      });

      state.values.hypothesis = text;
      state.values.hypothesisThought = thought;

      logger.info(
        {
          hypothesisLength: text.length,
          thoughtLength: thought?.length || 0,
        },
        "hypothesis_generated",
      );

      endStep(state, "HYPOTHESIS_DEEP_RESEARCH");

      // Update state in DB after endStep
      if (state.id) {
        try {
          await updateState(state.id, state.values);
        } catch (err) {
          logger.error({ err }, "failed_to_update_state");
        }
      }

      return {
        hypothesis: text,
        thought: thought,
        message: "Hypothesis generated successfully",
      };
    } catch (err) {
      logger.error({ err }, "hypothesis_generation_failed");

      endStep(state, "HYPOTHESIS_DEEP_RESEARCH");

      if (state.id) {
        try {
          await updateState(state.id, state.values);
        } catch (err) {
          logger.error({ err }, "failed_to_update_state");
        }
      }

      throw err;
    }
  },
};
