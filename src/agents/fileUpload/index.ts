import { updateState } from "../../db/operations";
import {
  getConversationBasePath,
  getStorageProvider,
  getUploadPath,
} from "../../storage";
import type {
  ConversationState,
  Message,
  State,
  UploadedFile,
} from "../../types/core";
import logger from "../../utils/logger";
import { addVariablesToState, endStep, startStep } from "../../utils/state";
import { generateUUID } from "../../utils/uuid";
import { MAX_FILE_SIZE_MB } from "./config";
import { parseFile } from "./parsers";
import { formatFileSize, mbToBytes } from "./utils";

const fileUploadTool = {
  name: "FILE-UPLOAD",
  description:
    "File upload provider that parses uploaded files (PDF, Excel, CSV, MD, JSON, TXT) and makes their content available to the LLM.",
  enabled: true,
  deepResearchEnabled: true,
  execute: async (input: {
    state: State;
    message: Message;
    conversationState: ConversationState;
    files?: File[];
  }) => {
    const { state, files, conversationState } = input;

    startStep(state, "FILE_UPLOAD");

    // Update state in DB after startStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        if (logger) logger.error("Failed to update state in DB:", err as any);
      }
    }

    if (!files || files.length === 0) {
      if (logger) logger.warn("FILE-UPLOAD tool called but no files provided");
      return {
        text: "No files to process",
        values: {},
      };
    }

    if (logger) logger.info(`📎 Processing ${files.length} uploaded file(s)`);

    const rawFiles: Array<{
      buffer: Buffer;
      filename: string;
      mimeType: string;
      parsedText: string;
      metadata?: any;
    }> = [];
    const errors: string[] = [];

    // Process each file
    for (const file of files) {
      try {
        // Convert File to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Check file size limit
        const maxSize = mbToBytes(MAX_FILE_SIZE_MB);
        if (buffer.length > maxSize) {
          errors.push(
            `${file.name}: File too large (${formatFileSize(buffer.length)}, max ${MAX_FILE_SIZE_MB}MB)`,
          );
          if (logger)
            logger.warn(
              `File ${file.name} exceeds size limit: ${formatFileSize(buffer.length)}`,
            );
          continue;
        }

        if (logger) logger.info(` Parsing file: ${file.name} (${file.type})`);

        // Parse the file for text context (fallback for non-Google providers)
        const parsed = await parseFile(buffer, file.name, file.type);

        // Store raw file buffer for Gemini File API + parsed text for fallback
        rawFiles.push({
          buffer,
          filename: file.name,
          mimeType: file.type,
          parsedText: parsed.text,
          metadata: parsed.metadata,
        });

        if (logger) logger.info(` Successfully parsed ${file.name}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${file.name}: ${errorMsg}`);
        if (logger)
          logger.error(`Failed to parse file ${file.name}:`, error as any);
      }
    }

    const conversationStateId = conversationState.id; // Use conversation_state ID for consistent file paths
    const userId = state.values.userId;
    const uploadedFiles = await uploadFilesToStorage(
      userId,
      conversationStateId,
      rawFiles,
    ).catch((err) => {
      errors.push(`Storage upload error: ${(err as Error).message}`);
      if (logger)
        logger.error("Failed to upload files to storage:", err as any);
      return [];
    });

    // Generate descriptions for uploaded files
    const uploadedDatasetsWithDescriptions = await Promise.all(
      uploadedFiles.map(async (file) => {
        const description = await generateFileDescription(
          file.filename,
          file.mimeType || "",
          rawFiles.find((rf) => rf.filename === file.filename)?.parsedText ||
            "",
        );
        return {
          id: file.id,
          filename: file.filename,
          description,
        };
      }),
    );

    // Update conversation state with newly uploaded datasets, replacing duplicates by filename
    const existingDatasets = conversationState.values.uploadedDatasets || [];
    const uploadedDatasets = [
      // keep only old ones whose filename is not in the new uploads
      ...existingDatasets.filter(
        (f) =>
          !uploadedDatasetsWithDescriptions.some(
            (nf) => nf.filename === f.filename,
          ),
      ),
      // then append all new files (they replace by filename)
      ...uploadedDatasetsWithDescriptions,
    ];

    addVariablesToState(conversationState, {
      uploadedDatasets,
    });

    // Store only rawFiles with parsed text included
    addVariablesToState(state, {
      rawFiles, // Contains buffer (for Gemini), parsedText (for fallback), and metadata
      fileUploadErrors: errors.length > 0 ? errors : undefined,
    });

    const result = {
      text: `Processed ${rawFiles.length} file(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ""}`,
      values: {
        rawFiles,
        fileUploadErrors: errors.length > 0 ? errors : undefined,
      },
    };

    endStep(state, "FILE_UPLOAD");

    // Update state in DB after endStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        if (logger) logger.error("Failed to update state in DB:", err as any);
      }
    }

    return result;
  },
};

/**
 * Generate a brief description of the uploaded file using AI
 */
async function generateFileDescription(
  filename: string,
  mimeType: string,
  parsedText: string,
): Promise<string> {
  const { LLM } = await import("../../llm/provider");

  // Create a short preview of the content
  const contentPreview = parsedText.slice(0, 1000);

  const prompt = `Analyze this uploaded file and provide a brief 1-sentence description of what it contains.

Filename: ${filename}
Type: ${mimeType}
Content preview:
${contentPreview}

Provide a concise description (max 100 characters) that would help identify this dataset for analysis tasks. Focus on:
- What type of data it contains (e.g., gene expression, clinical data, etc.)
- Key characteristics if obvious (e.g., number of samples, time period)

Examples:
- "RNA-seq data from mouse liver with 12,000 genes across 24 samples"
- "Clinical trial results comparing drug A vs placebo, n=500 patients"
- "Longitudinal aging biomarkers measured over 2 years"

Description:`;

  const DESCRIPTION_LLM_PROVIDER =
    process.env.PLANNING_LLM_PROVIDER || "google";
  const apiKey =
    process.env[`${DESCRIPTION_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!apiKey) {
    // Fallback to basic description
    return `${filename} (${mimeType})`;
  }

  try {
    const llmProvider = new LLM({
      // @ts-ignore
      name: DESCRIPTION_LLM_PROVIDER,
      apiKey,
    });

    const response = await llmProvider.createChatCompletion({
      model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-flash",
      messages: [
        {
          role: "user" as const,
          content: prompt,
        },
      ],
      maxTokens: 100,
    });

    const description = response.content.trim();
    if (logger) {
      logger.info(`Generated description for ${filename}: ${description}`);
    }

    return description;
  } catch (error) {
    if (logger) {
      logger.warn(
        `Failed to generate description for ${filename}, using fallback`,
      );
    }
    // Fallback to basic description
    return `${filename} (${mimeType})`;
  }
}

async function uploadFilesToStorage(
  userId: string | undefined,
  conversationId: string | undefined,
  files: Array<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    metadata?: any;
  }>,
): Promise<Array<UploadedFile>> {
  if (files.length === 0 || !conversationId || !userId) {
    if (logger)
      logger.warn(
        "No files to upload or missing conversationId/userId, skipping storage upload",
      );
    return [];
  }

  const storageProvider = getStorageProvider();

  if (!storageProvider) {
    if (logger)
      logger.warn(
        "No storage provider configured, skipping cloud storage upload",
      );
    return [];
  }

  if (logger)
    logger.info(
      `Uploading ${files.length} file(s) to storage for conversation ${conversationId} and user ${userId}`,
    );

  const uploadPromises = files.map(async (file) => {
    const uploadsPath = getUploadPath(file.filename);
    const fullPath = `${getConversationBasePath(userId, conversationId)}/${uploadsPath}`;

    try {
      await storageProvider.upload(fullPath, file.buffer, file.mimeType);
      if (logger)
        logger.info(`Successfully uploaded ${file.filename} to ${fullPath}`);
      return {
        id: generateUUID(),
        filename: file.filename,
        mimeType: file.mimeType,
        path: uploadsPath,
        metadata: file.metadata,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (logger)
        logger.error(
          `Failed to upload ${file.filename} to storage: ${errorMessage}`,
        );
      throw error;
    }
  });

  const uploadedFiles = await Promise.all(uploadPromises);

  if (logger)
    logger.info(
      `Successfully uploaded ${uploadedFiles.length} file(s) to storage`,
    );

  return uploadedFiles;
}

export default fileUploadTool;
export { fileUploadTool };
