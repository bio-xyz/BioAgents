import { updateState } from "../../db/operations";
import { getStorageProvider, getUserUploadPath } from "../../storage";
import { type Message, type State } from "../../types/core";
import logger from "../../utils/logger";
import { addVariablesToState, endStep, startStep } from "../../utils/state";
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
    conversationState: State;
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

    const conversationId = conversationState.id;
    const userId = state.values.userId;
    await uploadFilesToStorage(userId, conversationId, rawFiles).catch(
      (err) => {
        errors.push(`Storage upload error: ${(err as Error).message}`);
        if (logger)
          logger.error("Failed to upload files to storage:", err as any);
      },
    );

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

async function uploadFilesToStorage(
  userId: string | undefined,
  conversationId: string | undefined,
  files: Array<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    metadata?: any;
  }>,
): Promise<void> {
  if (files.length === 0 || !conversationId || !userId) {
    if (logger)
      logger.warn(
        "No files to upload or missing conversationId/userId, skipping storage upload",
      );
    return;
  }

  const storageProvider = getStorageProvider();

  if (!storageProvider) {
    if (logger)
      logger.warn(
        "No storage provider configured, skipping cloud storage upload",
      );
    return;
  }

  if (logger)
    logger.info(
      `Uploading ${files.length} file(s) to storage for conversation ${conversationId} and user ${userId}`,
    );

  const uploadPromises = files.map(async (file) => {
    const storagePath = getUserUploadPath(
      userId,
      conversationId,
      file.filename,
    );

    try {
      await storageProvider.upload(storagePath, file.buffer, file.mimeType);
      if (logger)
        logger.info(`Successfully uploaded ${file.filename} to ${storagePath}`);
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

  await Promise.all(uploadPromises);

  if (logger)
    logger.info(`Successfully uploaded ${files.length} file(s) to storage`);
}

export default fileUploadTool;
export { fileUploadTool };
