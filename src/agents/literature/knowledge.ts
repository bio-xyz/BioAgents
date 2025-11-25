import { VectorSearchWithDocuments } from "../../embeddings/vectorSearchWithDocs";
import logger from "../../utils/logger";

// Initialize vector search with documents at module level
const vectorSearch = new VectorSearchWithDocuments();

// Load documents on startup if KNOWLEDGE_DOCS_PATH is set
const docsPath = process.env.KNOWLEDGE_DOCS_PATH;
if (docsPath) {
  logger.info(`Loading knowledge base documents from: ${docsPath}`);
  await vectorSearch.loadDocsOnStartup(docsPath);
} else {
  logger.warn("KNOWLEDGE_DOCS_PATH not set, skipping document loading");
}

/**
 * Search knowledge base for relevant literature
 */
export async function searchKnowledge(objective: string): Promise<string> {
  if (!docsPath) {
    throw new Error("KNOWLEDGE_DOCS_PATH not configured");
  }

  logger.info({ objective }, "searching_knowledge_base");

  // Search for relevant documents (uses internal cache)
  const searchResults = await vectorSearch.search(objective);

  logger.info(
    { resultCount: searchResults.length },
    "knowledge_search_completed",
  );

  // Format output
  const output = `Found ${searchResults.length} relevant knowledge chunks:\n\n${searchResults
    .map(
      (doc, idx) =>
        `${idx + 1}. ${doc.title}\n   ${doc.content.substring(0, 300)}...`,
    )
    .join("\n\n")}`;

  return output;
}
