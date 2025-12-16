/**
 * File Description Generator
 * Generates AI-powered descriptions for uploaded files
 */

import logger from "../../utils/logger";

/**
 * Generate a brief description of a file using AI
 * @param filename - Name of the file
 * @param contentType - MIME type of the file
 * @param contentPreview - Preview of the file content (first ~4KB)
 * @returns AI-generated description or fallback
 */
export async function generateFileDescription(
  filename: string,
  contentType: string,
  contentPreview: string,
): Promise<string> {
  const { LLM } = await import("../../llm/provider");

  // Truncate preview to reasonable size for LLM
  const truncatedPreview = contentPreview.slice(0, 2000);

  const prompt = `Analyze this uploaded file and provide a brief 1-sentence description of what it contains.

Filename: ${filename}
Type: ${contentType}
Content preview:
${truncatedPreview}

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
    return `${filename} (${contentType || "unknown type"})`;
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
    logger.info({ filename, description }, "file_description_generated");

    return description;
  } catch (error) {
    logger.warn(
      { filename, error },
      "failed_to_generate_file_description_using_fallback",
    );
    // Fallback to basic description
    return `${filename} (${contentType || "unknown type"})`;
  }
}

/**
 * Parse file content to text for description generation
 * Handles different file types appropriately
 */
export async function parseFilePreview(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();

  try {
    // For text-based files, just decode as UTF-8
    if (
      contentType.startsWith("text/") ||
      ["csv", "json", "md", "txt"].includes(ext || "")
    ) {
      return buffer.toString("utf-8");
    }

    // For Excel files, try to extract basic info
    if (["xlsx", "xls"].includes(ext || "")) {
      // Return a placeholder - full parsing would require xlsx library
      return `[Excel file: ${filename}]`;
    }

    // For PDFs, return placeholder
    if (ext === "pdf" || contentType === "application/pdf") {
      return `[PDF file: ${filename}]`;
    }

    // For images, return placeholder
    if (contentType.startsWith("image/")) {
      return `[Image file: ${filename}]`;
    }

    // Default: try to decode as text
    return buffer.toString("utf-8");
  } catch (error) {
    logger.warn({ filename, error }, "failed_to_parse_file_preview");
    return `[Binary file: ${filename}]`;
  }
}
