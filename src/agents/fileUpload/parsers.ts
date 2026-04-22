import Papa from "papaparse";
import * as XLSX from "xlsx";
import { FILE_TYPES } from "./config";
import type { ParsedFile } from "./types";
import { formatFileSize, matchesExtension, matchesMimeType } from "./utils";

export type { ParsedFile } from "./types";

// ==================== Individual Parsers ====================

export async function parseExcel(buffer: Buffer, filename: string): Promise<ParsedFile> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  let allText = "";

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    allText += `\n=== Sheet: ${sheetName} ===\n${csv}\n`;
  }

  return {
    filename,
    metadata: {
      sheetCount: workbook.SheetNames.length,
      sheets: workbook.SheetNames,
    },
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    text: allText.trim(),
  };
}

export async function parseCSV(buffer: Buffer, filename: string): Promise<ParsedFile> {
  const text = buffer.toString("utf-8");
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    throw new Error(`CSV parsing errors: ${result.errors.map((e) => e.message).join(", ")}`);
  }

  const headers = result.meta.fields || [];
  let formattedText = headers.join(", ") + "\n";

  for (const row of result.data) {
    const values = headers.map((h: string) => row[h] || "");
    formattedText += values.join(", ") + "\n";
  }

  return {
    filename,
    metadata: {
      columns: headers.length,
      headers,
      rows: result.data.length,
    },
    mimeType: "text/csv",
    text: formattedText,
  };
}

export async function parseMarkdown(buffer: Buffer, filename: string): Promise<ParsedFile> {
  const text = buffer.toString("utf-8");
  return {
    filename,
    metadata: {
      size: buffer.length,
    },
    mimeType: "text/markdown",
    text,
  };
}

export async function parseJSON(buffer: Buffer, filename: string): Promise<ParsedFile> {
  const text = buffer.toString("utf-8");
  const data = JSON.parse(text);
  const formattedJSON = JSON.stringify(data, null, 2);

  return {
    filename,
    metadata: {
      size: buffer.length,
      type: Array.isArray(data) ? "array" : typeof data,
    },
    mimeType: "application/json",
    text: formattedJSON,
  };
}

export async function parseText(buffer: Buffer, filename: string): Promise<ParsedFile> {
  const text = buffer.toString("utf-8");
  return {
    filename,
    metadata: {
      size: buffer.length,
    },
    mimeType: "text/plain",
    text,
  };
}

export async function parsePDF(buffer: Buffer, filename: string): Promise<ParsedFile> {
  return {
    filename,
    metadata: {
      size: buffer.length,
      type: "pdf",
    },
    mimeType: "application/pdf",
    text: `[PDF Document: ${filename}]\nSize: ${formatFileSize(buffer.length)}\nNote: PDF content will be analyzed by the AI model.`,
  };
}

/**
 * Process image file metadata
 * Note: This doesn't extract text from images. For Gemini, the raw image buffer
 * is uploaded via File API for native image understanding. For other providers,
 * we provide a placeholder that informs the LLM an image is present.
 */
export async function parseImage(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ParsedFile> {
  // Determine image type from filename or mimeType
  let imageType = "image";
  if (mimeType.includes("png") || filename.endsWith(".png")) {
    imageType = "PNG";
  } else if (
    mimeType.includes("jpeg") ||
    mimeType.includes("jpg") ||
    filename.endsWith(".jpg") ||
    filename.endsWith(".jpeg")
  ) {
    imageType = "JPEG";
  } else if (mimeType.includes("webp") || filename.endsWith(".webp")) {
    imageType = "WebP";
  } else if (mimeType.includes("gif") || filename.endsWith(".gif")) {
    imageType = "GIF";
  }

  return {
    filename,
    metadata: {
      imageType,
      size: buffer.length,
      type: "image",
    },
    mimeType: mimeType || "image/unknown",
    // Placeholder text - actual image analysis happens at LLM level
    text: `[${imageType} Image: ${filename}]\nSize: ${formatFileSize(buffer.length)}\nNote: Image will be analyzed visually by the AI model.`,
  };
}

// ==================== Main Parser Function ====================

/**
 * Main parser function that routes to the appropriate parser based on file type
 */
export async function parseFile(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ParsedFile> {
  // Find matching parser by MIME type or extension
  const fileType =
    FILE_TYPES.find((ft) => matchesMimeType(mimeType, ft.mimeTypes)) ||
    FILE_TYPES.find((ft) => matchesExtension(filename, ft.extensions));

  if (!fileType) {
    const supportedExts = FILE_TYPES.flatMap((ft) => ft.extensions).join(", ");
    throw new Error(`Unsupported file type: ${mimeType}. Supported: ${supportedExts}`);
  }

  try {
    // Special handling for images to pass mimeType
    const isImageFile = mimeType.includes("image") || filename.match(/\.(png|jpg|jpeg|webp|gif)$/i);

    if (isImageFile) {
      return await parseImage(buffer, filename, mimeType);
    }

    return await fileType.parser(buffer, filename);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse file: ${errorMessage}`);
  }
}
