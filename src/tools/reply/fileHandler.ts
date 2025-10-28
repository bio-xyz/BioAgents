import type { LLMTool } from "../../llm/types";
import type { State } from "../../types/core";
import logger from "../../utils/logger";
import { detectFileTypes } from "./fileDetection";

/**
 * Handles file uploads for Google Gemini File API
 */
export async function uploadFilesToGemini(
  state: State,
  googleAdapter: any
): Promise<Array<{ fileUri: string; mimeType: string }>> {
  const rawFiles = state.values.rawFiles;

  if (!rawFiles?.length) {
    return [];
  }

  if (logger) logger.info(`📤 Uploading ${rawFiles.length} file(s) to Gemini File API`);

  try {
    const uploadPromises = rawFiles.map((rawFile: any) =>
      googleAdapter.uploadFile(rawFile.buffer, rawFile.filename, rawFile.mimeType)
    );

    const uploadedFiles = await Promise.all(uploadPromises);
    const geminiFileUris = uploadedFiles.map((file: any) => ({
      fileUri: file.uri!,
      mimeType: file.mimeType!,
    }));

    if (logger) logger.info(`✅ Successfully uploaded ${geminiFileUris.length} file(s) to Gemini`);
    return geminiFileUris;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (logger) logger.error({ error, errorMessage }, '❌ Failed to upload files to Gemini, falling back to parsed text');
    return [];
  }
}

/**
 * Adds parsed file text to the provider context string
 */
export function addParsedFilesToContext(
  state: State,
  providerString: string
): string {
  const rawFiles = state.values.rawFiles;

  if (!rawFiles?.length) {
    return providerString;
  }

  if (logger) logger.info(`📎 Adding ${rawFiles.length} uploaded file(s) to LLM context as text`);

  const filesString = rawFiles
    .map((file: any, index: number) => {
      const textLength = file.parsedText?.length || 0;
      if (logger) logger.info(`  [${index + 1}] ${file.filename} (${file.mimeType}) - ${textLength} characters`);
      return `[File ${index + 1}] ${file.filename} (${file.mimeType}):\n${file.parsedText}`;
    })
    .join("\n\n");

  let result = providerString + `\n\nUploaded files:\n${filesString}\n`;

  if (state.values.fileUploadErrors?.length) {
    if (logger) logger.warn(`⚠️  File upload errors: ${state.values.fileUploadErrors.join(", ")}`);
    result += `\nNote: Some files failed to upload: ${state.values.fileUploadErrors.join(", ")}\n`;
  }

  return result;
}

/**
 * Determines which tools to enable based on file types and provider
 */
export function configureToolsForFiles(
  templateKey: string,
  provider: string,
  model: string,
  state: State
): { tools: LLMTool[]; useWebSearch: boolean } {
  const fileTypes = detectFileTypes(state.values.rawFiles);
  const tools: LLMTool[] = [];

  // Simple web search enablement based on template
  const useWebSearch = templateKey.toLowerCase().includes("web");
  if (useWebSearch) {
    tools.push({ type: "webSearch" });
  }

  // Add code execution for Gemini models with data files
  if (provider === 'google' && model.includes('gemini') && fileTypes.hasDataFile) {
    tools.push({ type: 'codeExecution' });
  }

  return { tools, useWebSearch };
}
