/**
 * Literature search tool for the agent loop.
 * The LLM chooses which source to query and can call this tool multiple times
 * with different sources/queries as needed.
 * Self-registers on import.
 */

import { z } from "zod";
import { registerTool } from "../registry";
import logger from "../../utils/logger";
import { resolveSourceSelectionLiteratureOverride } from "../../utils/sourceSelectionRouting";

// Only fast sources — Edison and BIOLITDEEP are excluded because they use
// long-running polling (minutes), not suitable for chat mode.
const VALID_SOURCES = ["openscholar", "biolit", "knowledge"] as const;

const InputSchema = z.object({
  query: z.string(),
  source: z.enum(VALID_SOURCES).default("openscholar"),
});

registerTool({
  name: "literature_search",
  description:
    "Search bioscience literature from a specific academic source. Available sources: 'openscholar' (academic papers via OpenScholar), 'biolit' (BioLiterature agent — arxiv, pubmed, clinical trials), 'knowledge' (local knowledge base). Call this tool multiple times with different sources or queries to cross-reference findings.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A clear, specific scientific question or topic to search for",
      },
      source: {
        type: "string",
        enum: VALID_SOURCES,
        description:
          "Which literature source to search. 'openscholar' for academic papers, 'biolit' for broad search (arxiv, pubmed, clinical trials), 'knowledge' for local knowledge base. Defaults to 'openscholar'.",
      },
    },
    required: ["query"],
  },
  execute: async (input, context) => {
    const parsed = InputSchema.parse(input);
    const { query, source } = parsed;
    const override = resolveSourceSelectionLiteratureOverride({
      objective: query,
      sourceSelectionId: context?.sourceSelectionId,
      userMessage: context?.userMessage || query,
    });
    const effectiveSource = override.sources ? "biolit" : source;
    const effectiveQuery = override.objective;

    logger.info(
      {
        effectiveQuery,
        effectiveSource,
        query,
        source,
        sourceSelectionId: context?.sourceSelectionId,
        sourcesOverride: override.sources,
      },
      "literature_search_tool_started"
    );

    // Map source to literatureAgent type
    const sourceToType = {
      openscholar: "OPENSCHOLAR",
      biolit: "BIOLIT",
      knowledge: "KNOWLEDGE",
    } as const;

    // Check if source is configured
    const sourceEnvCheck = {
      openscholar: "OPENSCHOLAR_API_URL",
      biolit: "BIO_LIT_AGENT_API_URL",
      knowledge: "KNOWLEDGE_DOCS_PATH",
    } as const;

    const envVar = sourceEnvCheck[effectiveSource];
    if (!process.env[envVar]) {
      return {
        content: `Source "${effectiveSource}" is not configured (missing ${envVar} environment variable). Try a different source.`,
        isError: true,
      };
    }

    const TOOL_TIMEOUT_MS = parseInt(process.env.CHAT_TOOL_TIMEOUT_MS || "30000", 10);

    try {
      const { literatureAgent } = await import("../../agents/literature");

      // Note: Promise.race does not cancel the losing promise. On timeout,
      // the literatureAgent HTTP request continues in the background until it
      // completes. Proper cancellation requires adding AbortSignal support
      // to literatureAgent, which is shared across multiple consumers.
      const result = await Promise.race([
        literatureAgent({
          objective: effectiveQuery,
          sources: override.sources,
          type: sourceToType[effectiveSource],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS),
        ),
      ]);

      logger.info(
        {
          count: result.count,
          effectiveQuery,
          effectiveSource,
          outputLength: result.output.length,
          query,
          source,
        },
        "literature_search_tool_completed",
      );

      if (!result.output.trim()) {
        return {
          content: `No relevant literature found for: "${effectiveQuery}" (source: ${effectiveSource})`,
        };
      }

      return { content: result.output };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(
        { effectiveQuery, effectiveSource, err, query, source },
        "literature_search_tool_error"
      );
      return {
        content: `Literature search error (${effectiveSource}): ${message}`,
        isError: true,
      };
    }
  },
});
