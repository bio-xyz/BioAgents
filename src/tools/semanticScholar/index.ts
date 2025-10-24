import {
  getMessagesByConversation,
  updateState,
} from "../../db/operations";
import { callAnthropicWithSkills } from "../../llm/skills/skills";
import { type Message, type State } from "../../types/core";
import { SimpleCache } from "../../utils/cache";
import logger from "../../utils/logger";
import {
  addVariablesToState,
  getStandaloneMessage,
} from "../../utils/state";

// Cache for Semantic Scholar results (4 hours TTL)
const semanticScholarCache = new SimpleCache<any>();

export const semanticScholarTool = {
  name: "SEMANTIC_SCHOLAR",
  description:
    "Semantic Scholar plugin that queries the Anthropic Semantic Scholar skill to find relevant longevity papers based on the question and synthesizes them into a natural language response.",
  execute: async (input: { state: State; message: Message }) => {
    const { state, message } = input;

    addVariablesToState(state, { currentStep: "SEMANTIC_SCHOLAR" });

    const cacheKey = `semantic-scholar:data:${message.question}:${message.conversation_id}`;

    // Check cache first (4 hour TTL)
    const cachedResult = semanticScholarCache.get(cacheKey);
    if (cachedResult) {
      logger.info("Using cached Semantic Scholar result");

      // Restore state from cached result
      addVariablesToState(state, {
        semanticScholarSynthesis: cachedResult.values.semanticScholarSynthesis,
        semanticScholarPapers: cachedResult.values.semanticScholarPapers,
      });

      // Update state in DB with cached state
      if (state.id) {
        try {
          await updateState(state.id, state.values);
        } catch (err) {
          console.error("Failed to update state in DB:", err);
        }
      }

      return cachedResult;
    }

    // Get conversation thread (last 3 DB messages)
    const allMessages = await getMessagesByConversation(
      message.conversation_id,
      3,
    );
    // Reverse to get chronological order (oldest first)
    const thread = allMessages.reverse();

    // Generate standalone message based on thread
    const standaloneMessage = await getStandaloneMessage(
      thread,
      message.question || "",
    );

    // Add today's date to the question
    const today = new Date().toISOString().split("T")[0];
    const questionWithDate = `${standaloneMessage}. Today's date is ${today}`;

    logger.info(`Calling Semantic Scholar skill with: ${questionWithDate}`);

    // Call the Anthropic skill
    const skillResult = await callAnthropicWithSkills(questionWithDate);

    if (!skillResult || skillResult.is_error) {
      throw new Error("Semantic Scholar skill failed or returned no result");
    }

    logger.info(`Semantic Scholar skill completed in ${skillResult.duration_ms}ms`);
    logger.info(`Cost: $${skillResult.total_cost_usd.toFixed(4)}`);
    logger.info(`Tokens - Input: ${skillResult.usage.input_tokens}, Output: ${skillResult.usage.output_tokens}`);

    // Extract the text synthesis from the result
    const fullResult = skillResult.result;

    // Parse papers from the result
    // Papers are in format: "1. [Title] - URL: [url], Citations: [count]"
    const paperRegex = /^\d+\.\s+(.+?)\s+-\s+URL:\s+(https?:\/\/[^\s,]+)/gm;
    const semanticScholarPapers: Array<{doi: string, title: string, abstract: string}> = [];

    let match;
    while ((match = paperRegex.exec(fullResult)) !== null) {
      const title = match[1]?.trim();
      const url = match[2]?.trim();

      if (title && url) {
        semanticScholarPapers.push({
          doi: url, // Using URL as DOI
          title: title,
          abstract: "", // Empty abstract
        });
      }
    }

    logger.info(`Extracted ${semanticScholarPapers.length} papers from Semantic Scholar synthesis`);

    // Remove the "Science papers:" section and everything after it from the synthesis
    const sciencePapersMatch = fullResult.match(/\n\n(?:\*\*)?[Ss]cience [Pp]apers:?(?:\*\*)?/);
    const semanticScholarSynthesis = sciencePapersMatch
      ? fullResult.substring(0, sciencePapersMatch.index).trim()
      : fullResult;

    // Add to state
    addVariablesToState(state, {
      semanticScholarSynthesis,
      semanticScholarPapers,
    });

    const result = {
      text: "Semantic Scholar papers synthesis",
      values: {
        semanticScholarSynthesis,
        semanticScholarPapers,
      },
    };

    // Cache the result for 4 hours
    semanticScholarCache.set(cacheKey, result, 4 * 60 * 60 * 1000);

    // Update state in DB
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        // Log error but don't fail the tool execution
        console.error("Failed to update state in DB:", err);
      }
    }

    return result;
  },
};
