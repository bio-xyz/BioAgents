// lib/vectorSearchWithDocs.ts
import { getServiceClient } from "../db/client";
import logger from "../utils/logger";
import { DocumentProcessor } from "./documentProcessor";
import { TextChunker } from "./textChunker";
import { VectorSearchWithReranker } from "./vectorSearch";

// Use service client to bypass RLS for document operations
const supabase = getServiceClient();

export class VectorSearchWithDocuments extends VectorSearchWithReranker {
  private documentProcessor = new DocumentProcessor();
  private textChunker = new TextChunker();

  /**
   * Scans a directory on startup, compares its contents with documents
   * already in the database (by title), and loads only the new ones.
   * @param dirPath The path to the directory containing documents.
   */
  async loadDocsOnStartup(dirPath: string) {
    logger.info(`🚀 Starting document load for directory: ${dirPath}`);
    const startTime = Date.now();

    // 1. Get all unique titles currently stored in the database using DISTINCT
    const { data: existingDocs, error } = await supabase
      .from("documents")
      .select("title", { count: "exact" })
      .limit(10000);

    if (error) {
      logger.error(
        { err: error },
        "DB Error: Could not fetch existing document titles.",
      );
      return;
    }

    // Create Set from titles (handles any remaining duplicates)
    const existingTitles = new Set(
      existingDocs?.map((doc) => doc.title) || [],
    );
    logger.info(
      `🔍 Found ${existingTitles.size} unique titles in the database.`,
    );

    // 2. Process all local files to get their titles and content.
    const localDocs = await this.documentProcessor.processDirectory(dirPath);
    if (localDocs.length === 0) {
      logger.info("📂 No local documents found in the specified directory.");
      return;
    }

    logger.info(`📂 Found ${localDocs.length} local documents to check.`);

    let addedCount = 0;
    let skippedCount = 0;

    const newDocuments = localDocs.filter((doc) => {
      const exists = existingTitles.has(doc.title);
      if (exists) {
        logger.info(`⏭️  Skipping existing document: ${doc.title}`);
      } else {
        logger.info(`➕ New document to add: ${doc.title}`);
      }
      return !exists;
    });

    if (newDocuments.length === 0) {
      logger.info(
        "✅ All local documents are already in the database. No action needed.",
      );
      return;
    }

    logger.info(`➕ Found ${newDocuments.length} new documents to add.`);

    // 3. Process and add only the new documents in batches.
    const allChunks: Array<{
      title: string;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];

    // First, collect all chunks from all documents
    for (const doc of newDocuments) {
      try {
        const chunks = this.textChunker.chunkDocument(doc);
        if (chunks.length === 0) {
          logger.warn(`⚠️  Document "${doc.title}" produced 0 chunks!`);
        } else {
          logger.info(
            `   - Chunked "${doc.title}": ${chunks.length} chunk(s)`,
          );
        }
        allChunks.push(
          ...chunks.map((chunk) => ({
            title: chunk.title,
            content: chunk.content,
            metadata: chunk.metadata,
          })),
        );
        addedCount++;
      } catch (e) {
        logger.error({ err: e }, `  - Failed to chunk document "${doc.title}"`);
      }
    }

    logger.info(
      `📦 Total: ${allChunks.length} chunks from ${addedCount} documents (expected at least ${newDocuments.length} chunks)`,
    );

    // Add chunks in batches of 100 for optimal performance
    const BATCH_SIZE = 100;
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      logger.info(
        `   - Adding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allChunks.length / BATCH_SIZE)} (${batch.length} chunks)`,
      );
      try {
        await this.addDocuments(batch);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error(
          `  - Failed to add batch starting at index ${i}: ${message}`,
        );
        logger.error({ err: e }, `  - Error details`);
        // Log which documents were in this batch
        logger.error(
          `  - Documents in failed batch: ${batch.map((d) => d.title).join(", ")}`,
        );
      }
    }

    skippedCount = localDocs.length - addedCount;

    const duration = Date.now() - startTime;
    logger.info(`✅ Document loading complete in ${duration}ms.`);
    logger.info(
      `   Summary: Added ${addedCount} new documents. Skipped ${skippedCount} existing documents.`,
    );
  }

  /**
   * Processes and adds a single file to the vector store.
   * Useful for API endpoints that allow file uploads.
   * @param filePath The path to the file.
   */
  async addFile(filePath: string) {
    logger.info(`📄 Processing single file: ${filePath}`);

    const doc = await this.documentProcessor.processFile(filePath);
    if (!doc) {
      throw new Error(`Failed to process file: ${filePath}`);
    }

    const chunks = this.textChunker.chunkDocument(doc);
    logger.info(`   Split into ${chunks.length} chunks.`);

    // Use batch insert for better performance
    const chunksToAdd = chunks.map((chunk) => ({
      title: chunk.title,
      content: chunk.content,
      metadata: chunk.metadata,
    }));

    await this.addDocuments(chunksToAdd);

    return {
      title: doc.title,
      chunkCount: chunks.length,
    };
  }
}
