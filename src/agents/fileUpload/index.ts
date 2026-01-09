import { updateConversationState } from "../../db/operations";
import {
  getConversationBasePath,
  getStorageProvider,
  getUploadPath,
} from "../../storage";
import type { ConversationState, UploadedFile } from "../../types/core";
import logger from "../../utils/logger";
import { addVariablesToState } from "../../utils/state";
import { generateUUID } from "../../utils/uuid";
import { MAX_FILE_SIZE_MB } from "./config";
import { parseFile } from "./parsers";
import { formatFileSize, mbToBytes } from "./utils";

/**
 * File upload agent for processing and storing uploaded files
 * Independent agent that handles file parsing, storage, and description generation
 *
 * Flow:
 * 1. Parse uploaded files (PDF, Excel, CSV, MD, JSON, TXT)
 * 2. Upload to storage
 * 3. Generate AI descriptions
 * 4. Update conversation state with dataset metadata
 */
export async function fileUploadAgent(input: {
  conversationState: ConversationState;
  files: File[];
  userId: string;
}): Promise<{
  uploadedDatasets: Array<{ id: string; filename: string; description: string; path?: string; size?: number }>;
  errors: string[];
}> {
  const { files, conversationState, userId } = input;

  if (!files || files.length === 0) {
    logger.info("No files to process");
    return { uploadedDatasets: [], errors: [] };
  }

  logger.info(
    { fileCount: files.length, conversationStateId: conversationState.id },
    "file_upload_agent_started",
  );

  const rawFiles: Array<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    parsedText: string;
    metadata?: any;
    size: number;
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
        logger.warn(
          `File ${file.name} exceeds size limit: ${formatFileSize(buffer.length)}`,
        );
        continue;
      }

      logger.info(`Parsing file: ${file.name} (${file.type})`);

      // Parse the file for text context
      const parsed = await parseFile(buffer, file.name, file.type);

      // Store raw file buffer + parsed text
      rawFiles.push({
        buffer,
        filename: file.name,
        mimeType: file.type,
        parsedText: parsed.text,
        metadata: parsed.metadata,
        size: buffer.length,
      });

      logger.info(`Successfully parsed ${file.name}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`${file.name}: ${errorMsg}`);
      logger.error(`Failed to parse file ${file.name}:`, error as any);
    }
  }

  const conversationStateId = conversationState.id;
  const uploadedFiles = await uploadFilesToStorage(
    userId,
    conversationStateId,
    rawFiles,
  ).catch((err) => {
    errors.push(`Storage upload error: ${(err as Error).message}`);
    logger.error("Failed to upload files to storage:", err as any);
    return [];
  });

  // Generate descriptions for uploaded files
  const uploadedDatasetsWithDescriptions = await Promise.all(
    uploadedFiles.map(async (file) => {
      const rawFile = rawFiles.find((rf) => rf.filename === file.filename);
      const description = await generateFileDescription(
        file.filename,
        file.mimeType || "",
        rawFile?.parsedText || "",
      );
      return {
        id: file.id,
        filename: file.filename,
        description,
        path: file.path,
        size: rawFile?.size || 0,
      };
    }),
  );

  logger.info(
    {
      uploadedDatasets: uploadedDatasetsWithDescriptions.map((d) => ({
        filename: d.filename,
        description: d.description,
      })),
    },
    "file_descriptions_generated",
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

  // Persist conversation state to database
  if (conversationState.id) {
    try {
      await updateConversationState(
        conversationState.id,
        conversationState.values,
        { preserveUploadedDatasets: false }, // Allow file upload to update uploadedDatasets
      );
      logger.info(
        {
          conversationStateId: conversationState.id,
          uploadedDatasets: uploadedDatasets.map((d) => ({
            filename: d.filename,
            description: d.description,
          })),
        },
        "conversation_state_persisted",
      );
    } catch (err) {
      logger.error("Failed to update conversation state in DB:", err as any);
    }
  }

  logger.info(
    {
      uploadedCount: uploadedDatasets.length,
      errorCount: errors.length,
    },
    "file_upload_agent_completed",
  );

  return {
    uploadedDatasets,
    errors,
  };
}

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
