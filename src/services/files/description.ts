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

  // For CSV/TSV files, count actual rows from full content
  const ext = filename.split(".").pop()?.toLowerCase();
  let rowCountInfo = "";
  if (["csv", "tsv"].includes(ext || "") || contentType === "text/csv") {
    const lines = contentPreview.split("\n").filter(line => line.trim().length > 0);
    const rowCount = lines.length - 1; // Subtract header row
    rowCountInfo = `\nTotal rows (excluding header): ${rowCount}`;
  }

  const prompt = `Analyze this uploaded file and provide a brief 1-sentence description of what it contains.

Filename: ${filename}
Type: ${contentType}${rowCountInfo}
Content preview (first 2000 chars):
${truncatedPreview}

Provide a concise description (max 100 characters) that would help identify this dataset for analysis tasks. Focus on:
- What type of data it contains (e.g., gene expression, clinical data, etc.)
- Key characteristics if obvious (use the row count provided above for CSV files, not the preview)

Examples:
- "RNA-seq data from mouse liver with 12,000 genes across 24 samples"
- "Clinical trial results comparing drug A vs placebo, n=500 patients"
- "Twitter posts export with 258 tweets from @username"

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

    // For Excel files, extract data as CSV-like text
    if (["xlsx", "xls"].includes(ext || "")) {
      return await extractExcelContent(buffer, filename);
    }

    // For PDFs, extract text content
    if (ext === "pdf" || contentType === "application/pdf") {
      return await extractPDFText(buffer, filename);
    }

    // For images, use vision model to extract text/describe content
    if (contentType.startsWith("image/")) {
      return await extractImageContent(buffer, filename, contentType);
    }

    // Default: try to decode as text
    return buffer.toString("utf-8");
  } catch (error) {
    logger.warn({ filename, error }, "failed_to_parse_file_preview");
    return `[Binary file: ${filename}]`;
  }
}

/**
 * Extract text content from a PDF buffer using pdf-parse
 */
async function extractPDFText(buffer: Buffer, filename: string): Promise<string> {
  logger.info({ filename, bufferSize: buffer.length }, "pdf_extraction_starting");

  try {
    const { PDFParse } = await import("pdf-parse");

    // Use data parameter directly with buffer - avoids fs.promises issues
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    const text = result.text || "";
    logger.info({
      filename,
      textLength: text.length,
      textPreview: text.slice(0, 200)
    }, "pdf_text_extracted");

    await parser.destroy();

    if (text.length === 0) {
      logger.warn({ filename }, "pdf_extracted_empty_text");
      return `[PDF file: ${filename} - no extractable text (may be image-based or encrypted)]`;
    }

    // Return first 50KB of text for full content storage
    return text.slice(0, 50000);
  } catch (error: any) {
    // Capture all error details
    const errorDetails = {
      message: error?.message,
      name: error?.name,
      code: error?.code,
      toString: String(error),
      keys: error ? Object.keys(error) : [],
    };
    logger.error({
      filename,
      errorDetails,
      stack: error?.stack
    }, "pdf_extraction_failed");
    return `[PDF file: ${filename} - extraction error: ${error?.message || String(error) || 'unknown'}]`;
  }
}

/**
 * Extract text content from an image using OCR (tesseract.js)
 */
async function extractImageContent(buffer: Buffer, filename: string, contentType: string): Promise<string> {
  logger.info({ filename, bufferSize: buffer.length, contentType }, "image_ocr_starting");

  try {
    const Tesseract = await import("tesseract.js");

    // Create worker and recognize text
    const worker = await Tesseract.createWorker("eng");
    const { data } = await worker.recognize(buffer);
    await worker.terminate();

    const text = data.text?.trim() || "";

    logger.info({
      filename,
      textLength: text.length,
      textPreview: text.slice(0, 200),
      confidence: data.confidence,
    }, "image_ocr_completed");

    if (text.length === 0) {
      logger.warn({ filename }, "image_ocr_no_text_found");
      return `[Image file: ${filename} - no text detected]`;
    }

    // Return extracted text (limit to 50KB)
    return text.slice(0, 50000);
  } catch (error: any) {
    logger.error({
      filename,
      error: error?.message,
      stack: error?.stack
    }, "image_ocr_failed");
    return `[Image file: ${filename} - OCR error: ${error?.message || 'unknown'}]`;
  }
}

/**
 * Extract content from Excel files (xlsx, xls) using xlsx library
 */
async function extractExcelContent(buffer: Buffer, filename: string): Promise<string> {
  logger.info({ filename, bufferSize: buffer.length }, "excel_extraction_starting");

  try {
    const XLSX = await import("xlsx");

    // Read workbook from buffer
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const sheetNames = workbook.SheetNames;
    const results: string[] = [];

    // Process each sheet
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      // Convert to CSV format
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });

      if (csv.trim()) {
        // Count rows
        const rows = csv.split("\n").filter(row => row.trim().length > 0);
        const rowCount = rows.length - 1; // Subtract header

        results.push(`--- Sheet: ${sheetName} (${rowCount} rows) ---\n${csv}`);
      }
    }

    const text = results.join("\n\n");

    logger.info({
      filename,
      sheetCount: sheetNames.length,
      textLength: text.length,
      textPreview: text.slice(0, 200),
    }, "excel_content_extracted");

    if (text.length === 0) {
      logger.warn({ filename }, "excel_extracted_empty_content");
      return `[Excel file: ${filename} - no extractable content]`;
    }

    // Return up to 50KB of content
    return text.slice(0, 50000);
  } catch (error: any) {
    logger.error({
      filename,
      error: error?.message,
      stack: error?.stack
    }, "excel_extraction_failed");
    return `[Excel file: ${filename} - extraction error: ${error?.message || 'unknown'}]`;
  }
}
