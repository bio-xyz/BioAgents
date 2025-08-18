import {
  IAgentRuntime,
  Memory,
  MemoryType,
  ModelType,
  UUID,
  logger,
  splitChunks,
} from '@elizaos/core';
import { Buffer } from 'node:buffer';
import { v4 as uuidv4 } from 'uuid';
import { getProviderRateLimits, validateModelConfig } from './config.ts';
import {
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_CHUNK_OVERLAP_TOKENS,
  DEFAULT_CHUNK_TOKEN_SIZE,
  getCachingContextualizationPrompt,
  getCachingPromptForMimeType,
  getChunkWithContext,
  getContextualizationPrompt,
  getPromptForMimeType,
} from './ctx-embeddings.ts';
import { generateText } from './llm.ts';
import { convertPdfToTextFromBuffer, extractTextFromFileBuffer } from './utils.ts';

/**
 * Parse CSV content and convert to readable text format
 * @param csvContent Raw CSV content as string
 * @param originalFilename Original filename for context
 * @returns Formatted text representation of CSV data
 * 
 * Note: Processes up to 10,000 rows for performance optimization.
 * Large CSV files will be truncated with a summary note.
 * 
 * @example
 * Input CSV:
 * ```
 * Name,Age,City,Salary
 * John,30,"New York",75000
 * Alice,25,Boston,65000
 * ```
 * 
 * Output Text:
 * ```
 * Document: data.csv
 * CSV Data with 2 rows and 4 columns
 * 
 * Column Headers: Name, Age, City, Salary
 * 
 * Row 1:
 *   Name: John
 *   Age: 30
 *   City: New York
 *   Salary: 75000
 * 
 * Row 2:
 *   Name: Alice
 *   Age: 25
 *   City: Boston
 *   Salary: 65000
 * 
 * Numeric Column Statistics:
 *   Age: avg: 27.50, min: 25, max: 30, count: 2
 *   Salary: avg: 70000.00, min: 65000, max: 75000, count: 2
 * ```
 */
function parseCSVToText(csvContent: string, originalFilename: string): string {
  try {
    // Split into lines and handle different line endings
    const lines = csvContent.split(/\r\n|\r|\n/).filter(line => line.trim() !== '');

    if (lines.length === 0) {
      throw new Error('Empty CSV file');
    }

    // Parse CSV manually to handle quoted fields and commas within quotes
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            // Handle escaped quotes
            current += '"';
            i++; // Skip next quote
          } else {
            // Toggle quote state
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          // End of field
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }

      // Add the last field
      result.push(current.trim());
      return result;
    };

    // Parse header row
    const headers = parseCSVLine(lines[0]);
    const numColumns = headers.length;

    // Build formatted text output
    let textOutput = `Document: ${originalFilename}\n`;
    textOutput += `CSV Data with ${lines.length - 1} rows and ${numColumns} columns\n\n`;

    // Add header information
    textOutput += `Column Headers: ${headers.join(', ')}\n\n`;

    // Process data rows
    const dataRows = lines.slice(1);
    let processedRows = 0;
    const parsedDataRows: string[][] = []; // Store parsed rows for statistics

    for (let i = 0; i < dataRows.length && processedRows < 10000; i++) {
      const row = parseCSVLine(dataRows[i]);

      // Skip empty rows
      if (row.every(cell => cell === '')) {
        continue;
      }

      // Store parsed row for statistics
      parsedDataRows.push(row);

      textOutput += `Row ${processedRows + 1}:\n`;

      // Create structured row data
      for (let j = 0; j < Math.min(row.length, numColumns); j++) {
        const header = headers[j] || `Column_${j + 1}`;
        const value = row[j] || '';

        if (value.trim() !== '') {
          textOutput += `  ${header}: ${value}\n`;
        }
      }

      textOutput += '\n';
      processedRows++;
    }

    // Add summary if we truncated data
    if (dataRows.length > 10000) {
      textOutput += `\n[Note: CSV contains ${dataRows.length} total rows. Only first 10,000 rows processed for embedding.]\n`;
    }

    // Add statistical summary for numeric columns
    const numericStats = calculateCSVStatistics(parsedDataRows, headers);
    if (numericStats.length > 0) {
      textOutput += '\nNumeric Column Statistics:\n';
      numericStats.forEach(stat => {
        textOutput += `  ${stat.column}: ${stat.summary}\n`;
      });
    }

    return textOutput;

  } catch (error: any) {
    logger.error(`Error parsing CSV file ${originalFilename}: ${error.message}`);
    throw new Error(`Failed to parse CSV: ${error.message}`);
  }
}

/**
 * Calculate basic statistics for numeric columns in CSV
 * @param dataRows Array of parsed CSV rows
 * @param headers Column headers
 * @returns Array of column statistics
 */
function calculateCSVStatistics(dataRows: string[][], headers: string[]): Array<{ column: string, summary: string }> {
  const stats: Array<{ column: string, summary: string }> = [];

  for (let colIndex = 0; colIndex < headers.length; colIndex++) {
    const columnName = headers[colIndex];
    const columnValues = dataRows
      .map(row => row[colIndex]?.trim())
      .filter(val => val && val !== '');

    if (columnValues.length === 0) continue;

    // Check if column contains numeric data
    const numericValues = columnValues
      .map(val => parseFloat(val.replace(/[,$%]/g, '')))
      .filter(val => !isNaN(val));

    if (numericValues.length > columnValues.length * 0.5) {
      // Column is mostly numeric
      const sum = numericValues.reduce((a, b) => a + b, 0);
      const avg = sum / numericValues.length;
      const min = Math.min(...numericValues);
      const max = Math.max(...numericValues);

      stats.push({
        column: columnName,
        summary: `avg: ${avg.toFixed(2)}, min: ${min}, max: ${max}, count: ${numericValues.length}`
      });
    } else {
      // Column is text-based, provide basic info
      const uniqueValues = [...new Set(columnValues)].length;
      stats.push({
        column: columnName,
        summary: `${columnValues.length} values, ${uniqueValues} unique`
      });
    }
  }

  return stats;
}

/**
 * Estimates token count for a text string (rough approximation)
 * Uses the common 4 characters per token rule
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Gets CTX_KNOWLEDGE_ENABLED setting from runtime or environment
 * Ensures consistency with config.ts validation
 */
function getCtxKnowledgeEnabled(runtime?: IAgentRuntime): boolean {
  let result: boolean;
  let source: string;
  let rawValue: string | undefined;

  if (runtime) {
    rawValue = runtime.getSetting('CTX_KNOWLEDGE_ENABLED');
    // CRITICAL FIX: Use trim() and case-insensitive comparison
    const cleanValue = rawValue?.toString().trim().toLowerCase();
    result = cleanValue === 'true';
    source = 'runtime.getSetting()';
  } else {
    rawValue = process.env.CTX_KNOWLEDGE_ENABLED;
    const cleanValue = rawValue?.toString().trim().toLowerCase();
    result = cleanValue === 'true';
    source = 'process.env';
  }

  // Only log when there's a mismatch or for initial debugging
  if (process.env.NODE_ENV === 'development' && rawValue && !result) {
    logger.debug(
      `[Document Processor] 🔍 CTX config mismatch - ${source}: '${rawValue}' → ${result}`
    );
  }

  return result;
}

/**
 * Check if custom LLM should be used based on environment variables
 * Custom LLM is enabled when all three key variables are set:
 * - TEXT_PROVIDER
 * - TEXT_MODEL
 * - OPENROUTER_API_KEY (or provider-specific API key)
 */
function shouldUseCustomLLM(): boolean {
  const textProvider = process.env.TEXT_PROVIDER;
  const textModel = process.env.TEXT_MODEL;

  if (!textProvider || !textModel) {
    return false;
  }

  // Check for provider-specific API keys
  switch (textProvider.toLowerCase()) {
    case 'openrouter':
      return !!process.env.OPENROUTER_API_KEY;
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY;
    case 'google':
      return !!process.env.GOOGLE_API_KEY;
    default:
      return false;
  }
}

const useCustomLLM = shouldUseCustomLLM();

// =============================================================================
// MAIN DOCUMENT PROCESSING FUNCTIONS
// =============================================================================

/**
 * Process document fragments synchronously
 * This function:
 * 1. Splits the document text into chunks
 * 2. Enriches chunks with context if contextual Knowledge is enabled
 * 3. Generates embeddings for each chunk
 * 4. Stores fragments with embeddings in the database
 *
 * @param params Fragment parameters
 * @returns Number of fragments processed
 */
export async function processFragmentsSynchronously({
  runtime,
  documentId,
  fullDocumentText,
  agentId,
  contentType,
  roomId,
  entityId,
  worldId,
  documentTitle,
  chunksDbName = 'knowledge',
}: {
  runtime: IAgentRuntime;
  documentId: UUID;
  fullDocumentText: string;
  agentId: UUID;
  contentType?: string;
  roomId?: UUID;
  entityId?: UUID;
  worldId?: UUID;
  documentTitle?: string;
  chunksDbName?: string;
}): Promise<number> {
  if (!fullDocumentText || fullDocumentText.trim() === '') {
    logger.warn(`No text content available to chunk for document ${documentId}.`);
    return 0;
  }

  // Split the text into chunks using standard parameters
  const chunks = await splitDocumentIntoChunks(fullDocumentText);

  if (chunks.length === 0) {
    logger.warn(`No chunks generated from text for ${documentId}. No fragments to save.`);
    return 0;
  }

  const docName = documentTitle || documentId.substring(0, 8);
  logger.info(`[Document Processor] 📄 "${docName}": Split into ${chunks.length} chunks`);

  // Get provider limits for rate limiting
  const providerLimits = await getProviderRateLimits();
  const CONCURRENCY_LIMIT = Math.min(30, providerLimits.maxConcurrentRequests || 30);
  const rateLimiter = createRateLimiter(
    providerLimits.requestsPerMinute || 60,
    providerLimits.tokensPerMinute
  );

  logger.debug(
    `[Document Processor] 🛡️  Rate limits: ${providerLimits.requestsPerMinute} RPM, ${providerLimits.tokensPerMinute} TPM (${providerLimits.provider}, concurrency: ${CONCURRENCY_LIMIT})`
  );

  // Process and save fragments
  const { savedCount, failedCount } = await processAndSaveFragments({
    runtime,
    documentId,
    chunks,
    fullDocumentText,
    contentType,
    agentId,
    roomId: roomId || agentId,
    entityId: entityId || agentId,
    worldId: worldId || agentId,
    concurrencyLimit: CONCURRENCY_LIMIT,
    rateLimiter,
    documentTitle,
    chunksDbName,
  });

  // Report results with summary
  const successRate = ((savedCount / chunks.length) * 100).toFixed(1);

  if (failedCount > 0) {
    logger.warn(
      `[Document Processor] ⚠️  "${docName}": ${failedCount}/${chunks.length} chunks failed processing`
    );
  }

  logger.info(
    `[Document Processor] ✅ "${docName}" complete: ${savedCount}/${chunks.length} fragments saved (${successRate}% success)`
  );

  // Provide comprehensive end summary
  logKnowledgeGenerationSummary({
    documentId,
    totalChunks: chunks.length,
    savedCount,
    failedCount,
    successRate: parseFloat(successRate),
    ctxEnabled: getCtxKnowledgeEnabled(runtime),
    providerLimits,
  });

  return savedCount;
}

// =============================================================================
// DOCUMENT EXTRACTION & MEMORY FUNCTIONS
// =============================================================================

/**
 * Extract text from document buffer based on content type
 * @param fileBuffer Document buffer
 * @param contentType MIME type of the document
 * @param originalFilename Original filename
 * @returns Extracted text
 */
export async function extractTextFromDocument(
  fileBuffer: Buffer,
  contentType: string,
  originalFilename: string
): Promise<string> {
  // Validate buffer
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error(`Empty file buffer provided for ${originalFilename}. Cannot extract text.`);
  }

  try {
    if (contentType === 'application/pdf') {
      logger.debug(`Extracting text from PDF: ${originalFilename}`);
      return await convertPdfToTextFromBuffer(fileBuffer, originalFilename);
    } else if (contentType === 'text/csv') {
      logger.debug(`Extracting text from CSV: ${originalFilename}`);
      return parseCSVToText(fileBuffer.toString('utf8'), originalFilename);
    } else {
      logger.debug(`Extracting text from non-PDF/CSV: ${originalFilename} (Type: ${contentType})`);

      // For plain text files, try UTF-8 decoding first
      if (
        contentType.includes('text/') ||
        contentType.includes('application/json') ||
        contentType.includes('application/xml')
      ) {
        try {
          return fileBuffer.toString('utf8');
        } catch (textError) {
          logger.warn(
            `Failed to decode ${originalFilename} as UTF-8, falling back to binary extraction`
          );
        }
      }

      // For other files, use general extraction
      return await extractTextFromFileBuffer(fileBuffer, contentType, originalFilename);
    }
  } catch (error: any) {
    logger.error(`Error extracting text from ${originalFilename}: ${error.message}`);
    throw new Error(`Failed to extract text from ${originalFilename}: ${error.message}`);
  }
}

/**
 * Create a memory object for the main document
 * @param params Document parameters
 * @returns Memory object for the main document
 */
export function createDocumentMemory({
  text,
  agentId,
  clientDocumentId,
  originalFilename,
  contentType,
  worldId,
  fileSize,
  documentId,
  customMetadata,
}: {
  text: string;
  agentId: UUID;
  clientDocumentId: UUID;
  originalFilename: string;
  contentType: string;
  worldId: UUID;
  fileSize: number;
  documentId?: UUID;
  customMetadata?: Record<string, unknown>;
}): Memory {
  const fileExt = originalFilename.split('.').pop()?.toLowerCase() || '';
  const title = originalFilename.replace(`.${fileExt}`, '');

  // Use the provided documentId or generate a new one
  const docId = documentId || (uuidv4() as UUID);

  return {
    id: docId,
    agentId,
    roomId: agentId,
    worldId,
    entityId: agentId,
    content: { text },
    metadata: {
      type: MemoryType.DOCUMENT,
      documentId: clientDocumentId,
      originalFilename,
      contentType,
      title,
      fileExt,
      fileSize,
      source: 'rag-service-main-upload',
      timestamp: Date.now(),
      // Merge custom metadata if provided
      ...(customMetadata || {}),
    },
  };
}

// =============================================================================
// CHUNKING AND FRAGMENT PROCESSING
// =============================================================================

/**
 * Split document text into chunks using standard parameters
 * @param documentText The full document text to split
 * @returns Array of text chunks
 */
async function splitDocumentIntoChunks(documentText: string): Promise<string[]> {
  // Use the standardized constants
  const tokenChunkSize = DEFAULT_CHUNK_TOKEN_SIZE;
  const tokenChunkOverlap = DEFAULT_CHUNK_OVERLAP_TOKENS;

  // Calculate character-based chunking sizes from token sizes for compatibility with splitChunks
  const targetCharChunkSize = Math.round(tokenChunkSize * DEFAULT_CHARS_PER_TOKEN);
  const targetCharChunkOverlap = Math.round(tokenChunkOverlap * DEFAULT_CHARS_PER_TOKEN);

  logger.debug(
    `Using core splitChunks with settings: tokenChunkSize=${tokenChunkSize}, tokenChunkOverlap=${tokenChunkOverlap}, ` +
    `charChunkSize=${targetCharChunkSize}, charChunkOverlap=${targetCharChunkOverlap}`
  );

  // Split the text into chunks
  return await splitChunks(documentText, tokenChunkSize, tokenChunkOverlap);
}

/**
 * Process and save document fragments
 * @param params Processing parameters
 * @returns Object with counts of saved and failed fragments
 */
async function processAndSaveFragments({
  runtime,
  documentId,
  chunks,
  fullDocumentText,
  contentType,
  agentId,
  roomId,
  entityId,
  worldId,
  concurrencyLimit,
  rateLimiter,
  documentTitle,
  chunksDbName = 'knowledge',
}: {
  runtime: IAgentRuntime;
  documentId: UUID;
  chunks: string[];
  fullDocumentText: string;
  contentType?: string;
  agentId: UUID;
  roomId?: UUID;
  entityId?: UUID;
  worldId?: UUID;
  concurrencyLimit: number;
  rateLimiter: (estimatedTokens?: number) => Promise<void>;
  documentTitle?: string;
  chunksDbName?: string;
}): Promise<{
  savedCount: number;
  failedCount: number;
  failedChunks: number[];
}> {
  let savedCount = 0;
  let failedCount = 0;
  const failedChunks: number[] = [];

  // Process chunks in batches to respect concurrency limits
  for (let i = 0; i < chunks.length; i += concurrencyLimit) {
    const batchChunks = chunks.slice(i, i + concurrencyLimit);
    const batchOriginalIndices = Array.from({ length: batchChunks.length }, (_, k) => i + k);

    logger.debug(
      `[Document Processor] 📦 Batch ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(chunks.length / concurrencyLimit)}: processing ${batchChunks.length} chunks (${batchOriginalIndices[0]}-${batchOriginalIndices[batchOriginalIndices.length - 1]})`
    );

    // Process context generation in an optimized batch
    const contextualizedChunks = await getContextualizedChunks(
      runtime,
      fullDocumentText,
      batchChunks,
      contentType,
      batchOriginalIndices,
      documentTitle
    );

    // Generate embeddings with rate limiting
    const embeddingResults = await generateEmbeddingsForChunks(
      runtime,
      contextualizedChunks,
      rateLimiter
    );

    // Save fragments with embeddings
    for (const result of embeddingResults) {
      const originalChunkIndex = result.index;

      if (!result.success) {
        failedCount++;
        failedChunks.push(originalChunkIndex);
        logger.warn(`Failed to process chunk ${originalChunkIndex} for document ${documentId}`);
        continue;
      }

      const contextualizedChunkText = result.text;
      const embedding = result.embedding;

      if (!embedding || embedding.length === 0) {
        logger.warn(
          `Zero vector detected for chunk ${originalChunkIndex} (document ${documentId}). Embedding: ${JSON.stringify(result.embedding)}`
        );
        failedCount++;
        failedChunks.push(originalChunkIndex);
        continue;
      }

      try {
        const fragmentMemory: Memory = {
          id: uuidv4() as UUID,
          agentId,
          roomId: roomId || agentId,
          worldId: worldId || agentId,
          entityId: entityId || agentId,
          embedding,
          content: { text: contextualizedChunkText },
          metadata: {
            type: MemoryType.FRAGMENT,
            documentId,
            position: originalChunkIndex,
            timestamp: Date.now(),
            source: 'rag-service-fragment-sync',
          },
        };

        await runtime.createMemory(fragmentMemory, chunksDbName);
        // Log when all chunks for this document are processed
        if (originalChunkIndex === chunks.length - 1) {
          const docName = documentTitle || documentId.substring(0, 8);
          logger.info(
            `[Document Processor] ✓ "${docName}": All ${chunks.length} chunks processed successfully`
          );
        }
        savedCount++;
      } catch (saveError: any) {
        logger.error(
          `Error saving chunk ${originalChunkIndex} to database: ${saveError.message}`,
          saveError.stack
        );
        failedCount++;
        failedChunks.push(originalChunkIndex);
      }
    }

    // Add a small delay between batches to prevent overwhelming the API
    if (i + concurrencyLimit < chunks.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return { savedCount, failedCount, failedChunks };
}

/**
 * Generate embeddings for contextualized chunks
 * @param runtime IAgentRuntime
 * @param contextualizedChunks Array of contextualized chunks
 * @param rateLimiter Rate limiter function
 * @returns Array of embedding results
 */
async function generateEmbeddingsForChunks(
  runtime: IAgentRuntime,
  contextualizedChunks: Array<{
    contextualizedText: string;
    index: number;
    success: boolean;
  }>,
  rateLimiter: (estimatedTokens?: number) => Promise<void>
): Promise<Array<any>> {
  // Filter out failed chunks
  const validChunks = contextualizedChunks.filter((chunk) => chunk.success);
  const failedChunks = contextualizedChunks.filter((chunk) => !chunk.success);

  if (validChunks.length === 0) {
    return failedChunks.map((chunk) => ({
      success: false,
      index: chunk.index,
      error: new Error('Chunk processing failed'),
      text: chunk.contextualizedText,
    }));
  }

  // Always use individual processing with ElizaOS runtime (keeping embeddings simple)
  return await Promise.all(
    contextualizedChunks.map(async (contextualizedChunk) => {
      if (!contextualizedChunk.success) {
        return {
          success: false,
          index: contextualizedChunk.index,
          error: new Error('Chunk processing failed'),
          text: contextualizedChunk.contextualizedText,
        };
      }

      // Apply rate limiting before embedding generation
      const embeddingTokens = estimateTokens(contextualizedChunk.contextualizedText);
      await rateLimiter(embeddingTokens);

      try {
        const generateEmbeddingOperation = async () => {
          return await generateEmbeddingWithValidation(
            runtime,
            contextualizedChunk.contextualizedText
          );
        };

        const { embedding, success, error } = await withRateLimitRetry(
          generateEmbeddingOperation,
          `embedding generation for chunk ${contextualizedChunk.index}`
        );

        if (!success) {
          return {
            success: false,
            index: contextualizedChunk.index,
            error,
            text: contextualizedChunk.contextualizedText,
          };
        }

        return {
          embedding,
          success: true,
          index: contextualizedChunk.index,
          text: contextualizedChunk.contextualizedText,
        };
      } catch (error: any) {
        logger.error(
          `Error generating embedding for chunk ${contextualizedChunk.index}: ${error.message}`
        );
        return {
          success: false,
          index: contextualizedChunk.index,
          error,
          text: contextualizedChunk.contextualizedText,
        };
      }
    })
  );
}

// =============================================================================
// CONTEXTUAL ENRICHMENT FUNCTIONS
// =============================================================================

/**
 * Generate contextual chunks if contextual Knowledge is enabled
 */
async function getContextualizedChunks(
  runtime: IAgentRuntime,
  fullDocumentText: string | undefined,
  chunks: string[],
  contentType: string | undefined,
  batchOriginalIndices: number[],
  documentTitle?: string
): Promise<Array<{ contextualizedText: string; index: number; success: boolean }>> {
  const ctxEnabled = getCtxKnowledgeEnabled(runtime);
  const isPdf = contentType === 'application/pdf';

  // Log configuration state once per document (not per batch)
  if (batchOriginalIndices[0] === 0) {
    const docName = documentTitle || 'Document';
    const provider = runtime?.getSetting('TEXT_PROVIDER') || process.env.TEXT_PROVIDER;
    const model = runtime?.getSetting('TEXT_MODEL') || process.env.TEXT_MODEL;

    if (isPdf) {
      logger.info(`[Document Processor] 📋 "${docName}": PDF detected - skipping CTX enrichment`);
    } else {
      logger.info(
        `[Document Processor] 📋 "${docName}": CTX enrichment ${ctxEnabled ? 'ENABLED' : 'DISABLED'}${ctxEnabled ? ` (${provider}/${model})` : ''}`
      );
    }
  }

  // For PDFs or when CTX is disabled, return chunks without modification
  if (isPdf || !ctxEnabled || !fullDocumentText) {
    if (!isPdf && !ctxEnabled && batchOriginalIndices[0] === 0) {
      logger.debug(
        `[Document Processor] ℹ️  To enable CTX: Set CTX_KNOWLEDGE_ENABLED=true and configure TEXT_PROVIDER/TEXT_MODEL`
      );
    }

    return chunks.map((chunkText, idx) => ({
      contextualizedText: chunkText,
      index: batchOriginalIndices[idx],
      success: true,
    }));
  }

  // Enhanced logging for contextual processing
  return await generateContextsInBatch(
    runtime,
    fullDocumentText,
    chunks,
    contentType,
    batchOriginalIndices,
    documentTitle
  );
}

/**
 * Generate contexts for multiple chunks in a single batch
 */
async function generateContextsInBatch(
  runtime: IAgentRuntime,
  fullDocumentText: string,
  chunks: string[],
  contentType?: string,
  batchIndices?: number[],
  documentTitle?: string
): Promise<Array<{ contextualizedText: string; success: boolean; index: number }>> {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  const providerLimits = await getProviderRateLimits();
  const rateLimiter = createRateLimiter(
    providerLimits.requestsPerMinute || 60,
    providerLimits.tokensPerMinute
  );

  // Get active provider from validateModelConfig
  const config = validateModelConfig();
  const isUsingOpenRouter = config.TEXT_PROVIDER === 'openrouter';
  const isUsingCacheCapableModel =
    isUsingOpenRouter &&
    (config.TEXT_MODEL?.toLowerCase().includes('claude') ||
      config.TEXT_MODEL?.toLowerCase().includes('gemini'));

  logger.debug(
    `[Document Processor] 🎯 Contextualizing ${chunks.length} chunks with ${config.TEXT_PROVIDER}/${config.TEXT_MODEL} (cache: ${isUsingCacheCapableModel})`
  );

  // Prepare prompts or system messages in parallel
  const promptConfigs = prepareContextPrompts(
    chunks,
    fullDocumentText,
    contentType,
    batchIndices,
    isUsingCacheCapableModel
  );

  // Process valid prompts with rate limiting
  const contextualizedChunks = await Promise.all(
    promptConfigs.map(async (item) => {
      if (!item.valid) {
        return {
          contextualizedText: item.chunkText,
          success: false,
          index: item.originalIndex,
        };
      }

      // Apply rate limiting before making API call
      const llmTokens = estimateTokens(item.chunkText + (item.prompt || ''));
      await rateLimiter(llmTokens);

      try {
        let llmResponse;

        const generateTextOperation = async () => {
          if (useCustomLLM) {
            // Use custom LLM with caching support
            if (item.usesCaching) {
              // Use the newer caching approach with separate document
              return await generateText(item.promptText!, item.systemPrompt, {
                cacheDocument: item.fullDocumentTextForContext,
                cacheOptions: { type: 'ephemeral' },
                autoCacheContextualRetrieval: true,
              });
            } else {
              // Original approach - document embedded in prompt
              return await generateText(item.prompt!);
            }
          } else {
            // Fall back to runtime.useModel (original behavior)
            if (item.usesCaching) {
              // Use the newer caching approach with separate document
              // Note: runtime.useModel doesn't support cacheDocument/cacheOptions
              return await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: item.promptText!,
                system: item.systemPrompt,
              });
            } else {
              // Original approach - document embedded in prompt
              return await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: item.prompt!,
              });
            }
          }
        };

        llmResponse = await withRateLimitRetry(
          generateTextOperation,
          `context generation for chunk ${item.originalIndex}`
        );

        const generatedContext = typeof llmResponse === 'string' ? llmResponse : llmResponse.text;
        const contextualizedText = getChunkWithContext(item.chunkText, generatedContext);

        // Track context generation progress without spam
        if (
          (item.originalIndex + 1) % Math.max(1, Math.floor(chunks.length / 3)) === 0 ||
          item.originalIndex === chunks.length - 1
        ) {
          const docName = documentTitle || 'Document';
          logger.debug(
            `[Document Processor] 🧠 "${docName}": Context added for ${item.originalIndex + 1}/${chunks.length} chunks`
          );
        }

        return {
          contextualizedText,
          success: true,
          index: item.originalIndex,
        };
      } catch (error: any) {
        logger.error(
          `Error generating context for chunk ${item.originalIndex}: ${error.message}`,
          error.stack
        );
        return {
          contextualizedText: item.chunkText,
          success: false,
          index: item.originalIndex,
        };
      }
    })
  );

  return contextualizedChunks;
}

/**
 * Prepare prompts for contextualization
 */
function prepareContextPrompts(
  chunks: string[],
  fullDocumentText: string,
  contentType?: string,
  batchIndices?: number[],
  isUsingCacheCapableModel = false
): Array<any> {
  return chunks.map((chunkText, idx) => {
    const originalIndex = batchIndices ? batchIndices[idx] : idx;
    try {
      // If we're using OpenRouter with Claude/Gemini, use the newer caching approach
      if (isUsingCacheCapableModel) {
        // Get optimized caching prompt from ctx-embeddings.ts
        const cachingPromptInfo = contentType
          ? getCachingPromptForMimeType(contentType, chunkText)
          : getCachingContextualizationPrompt(chunkText);

        // If there was an error in prompt generation
        if (cachingPromptInfo.prompt.startsWith('Error:')) {
          logger.warn(
            `Skipping contextualization for chunk ${originalIndex} due to: ${cachingPromptInfo.prompt}`
          );
          return {
            originalIndex,
            chunkText,
            valid: false,
            usesCaching: false,
          };
        }

        return {
          valid: true,
          originalIndex,
          chunkText,
          usesCaching: true,
          systemPrompt: cachingPromptInfo.systemPrompt,
          promptText: cachingPromptInfo.prompt,
          fullDocumentTextForContext: fullDocumentText,
        };
      } else {
        // Original approach - embed document in the prompt
        const prompt = contentType
          ? getPromptForMimeType(contentType, fullDocumentText, chunkText)
          : getContextualizationPrompt(fullDocumentText, chunkText);

        if (prompt.startsWith('Error:')) {
          logger.warn(`Skipping contextualization for chunk ${originalIndex} due to: ${prompt}`);
          return {
            prompt: null,
            originalIndex,
            chunkText,
            valid: false,
            usesCaching: false,
          };
        }

        return {
          prompt,
          originalIndex,
          chunkText,
          valid: true,
          usesCaching: false,
        };
      }
    } catch (error: any) {
      logger.error(
        `Error preparing prompt for chunk ${originalIndex}: ${error.message}`,
        error.stack
      );
      return {
        prompt: null,
        originalIndex,
        chunkText,
        valid: false,
        usesCaching: false,
      };
    }
  });
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Helper to generate embedding with proper error handling and validation
 */
async function generateEmbeddingWithValidation(
  runtime: IAgentRuntime,
  text: string
): Promise<{
  embedding: number[] | null;
  success: boolean;
  error?: any;
}> {
  try {
    // Always use ElizaOS runtime for embeddings (keep it simple as requested)
    const embeddingResult = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
      text,
    });

    // Handle different embedding result formats consistently
    const embedding = Array.isArray(embeddingResult)
      ? embeddingResult
      : (embeddingResult as { embedding: number[] })?.embedding;

    // Validate embedding
    if (!embedding || embedding.length === 0) {
      logger.warn(`Zero vector detected. Embedding result: ${JSON.stringify(embedding)}`);
      return {
        embedding: null,
        success: false,
        error: new Error('Zero vector detected'),
      };
    }

    return { embedding, success: true };
  } catch (error: any) {
    return { embedding: null, success: false, error };
  }
}

/**
 * Handle rate-limited API calls with automatic retry
 */
async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  errorContext: string,
  retryDelay?: number
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (error.status === 429) {
      // Handle rate limiting with exponential backoff
      const delay = retryDelay || error.headers?.['retry-after'] || 5;
      logger.warn(`Rate limit hit for ${errorContext}. Retrying after ${delay}s`);
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));

      // Try one more time
      try {
        return await operation();
      } catch (retryError: any) {
        logger.error(`Failed after retry for ${errorContext}: ${retryError.message}`);
        throw retryError;
      }
    }
    throw error;
  }
}

/**
 * Creates a comprehensive rate limiter that tracks both requests and tokens
 */
function createRateLimiter(requestsPerMinute: number, tokensPerMinute?: number) {
  const requestTimes: number[] = [];
  const tokenUsage: Array<{ timestamp: number; tokens: number }> = [];
  const intervalMs = 60 * 1000; // 1 minute in milliseconds

  return async function rateLimiter(estimatedTokens: number = 1000) {
    const now = Date.now();

    // Remove old timestamps
    while (requestTimes.length > 0 && now - requestTimes[0] > intervalMs) {
      requestTimes.shift();
    }

    // Remove old token usage
    while (tokenUsage.length > 0 && now - tokenUsage[0].timestamp > intervalMs) {
      tokenUsage.shift();
    }

    // Calculate current token usage
    const currentTokens = tokenUsage.reduce((sum, usage) => sum + usage.tokens, 0);

    // Check both request and token limits
    const requestLimitExceeded = requestTimes.length >= requestsPerMinute;
    const tokenLimitExceeded = tokensPerMinute && currentTokens + estimatedTokens > tokensPerMinute;

    if (requestLimitExceeded || tokenLimitExceeded) {
      let timeToWait = 0;

      if (requestLimitExceeded) {
        const oldestRequest = requestTimes[0];
        timeToWait = Math.max(timeToWait, oldestRequest + intervalMs - now);
      }

      if (tokenLimitExceeded) {
        const oldestTokenUsage = tokenUsage[0];
        timeToWait = Math.max(timeToWait, oldestTokenUsage.timestamp + intervalMs - now);
      }

      if (timeToWait > 0) {
        const reason = requestLimitExceeded ? 'request' : 'token';
        // Only log significant waits to reduce spam
        if (timeToWait > 5000) {
          logger.info(
            `[Document Processor] 🐌 Rate limiting: waiting ${Math.round(timeToWait / 1000)}s due to ${reason} limit`
          );
        } else {
          logger.debug(
            `[Document Processor] ⏳ Rate limiting: ${timeToWait}ms wait (${reason} limit)`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, timeToWait));
      }
    }

    // Record this request
    requestTimes.push(now);
    if (tokensPerMinute) {
      tokenUsage.push({ timestamp: now, tokens: estimatedTokens });
    }
  };
}

/**
 * Logs a comprehensive summary of the knowledge generation process
 */
function logKnowledgeGenerationSummary({
  totalChunks,
  savedCount,
  failedCount,
  ctxEnabled,
  providerLimits,
}: {
  documentId: UUID;
  totalChunks: number;
  savedCount: number;
  failedCount: number;
  successRate: number;
  ctxEnabled: boolean;
  providerLimits: any;
}) {
  // Only show summary for failed processing or debug mode
  if (failedCount > 0 || process.env.NODE_ENV === 'development') {
    const status = failedCount > 0 ? '⚠️ PARTIAL' : '✅ SUCCESS';
    logger.info(
      `[Document Processor] ${status}: ${savedCount}/${totalChunks} chunks, CTX: ${ctxEnabled ? 'ON' : 'OFF'}, Provider: ${providerLimits.provider}`
    );
  }

  if (failedCount > 0) {
    logger.warn(`[Document Processor] ⚠️ ${failedCount} chunks failed processing`);
  }
}
