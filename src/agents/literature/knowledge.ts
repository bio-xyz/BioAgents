// No module-level imports that could cause TDZ in Bun workers
// All imports are dynamic inside functions

import type { LiteratureResult } from "../../utils/literature";

export async function initKnowledgeBase() {
  const logger = (await import("../../utils/logger")).default;
  const docsPath = process.env.KNOWLEDGE_DOCS_PATH;

  if (docsPath) {
    logger.info(`Loading knowledge base documents from: ${docsPath}`);
    const { VectorSearchWithDocuments } = await import("../../embeddings/vectorSearchWithDocs");
    const vectorSearch = new VectorSearchWithDocuments();
    await vectorSearch.loadDocsOnStartup(docsPath);
    // Store in globalThis for reuse
    (globalThis as any).__knowledgeVectorSearch = vectorSearch;
  } else {
    logger.warn("KNOWLEDGE_DOCS_PATH not set, skipping document loading");
  }
}

/**
 * Search knowledge base for relevant literature
 */
export async function searchKnowledge(
  objective: string,
): Promise<LiteratureResult> {
  const logger = (await import("../../utils/logger")).default;
  const docsPath = process.env.KNOWLEDGE_DOCS_PATH;

  if (!docsPath) {
    throw new Error("KNOWLEDGE_DOCS_PATH not configured");
  }

  logger.info({ objective }, "searching_knowledge_base");

  // Get or create vector search instance
  let vectorSearch = (globalThis as any).__knowledgeVectorSearch;
  if (!vectorSearch) {
    const { VectorSearchWithDocuments } = await import("../../embeddings/vectorSearchWithDocs");
    vectorSearch = new VectorSearchWithDocuments();
    (globalThis as any).__knowledgeVectorSearch = vectorSearch;
  }

  const searchResults = await vectorSearch.search(objective);

  logger.info(
    { resultCount: searchResults.length },
    "knowledge_search_completed",
  );

  // Format output
  const output =
    searchResults.length === 0
      ? `Found 0 relevant knowledge chunks (no results)`
      : `Found ${searchResults.length} relevant knowledge chunks:\n\n${searchResults
          .map(
            (doc: any, idx: number) =>
              `${idx + 1}. ${doc.title}\n   ${doc.content.substring(0, 300)}...`,
          )
          .join("\n\n")}`;

  return {
    output,
    count: searchResults.length,
  };
}
