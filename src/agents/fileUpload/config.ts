import type { FileTypeConfig } from "./types";
import {
  parseExcel,
  parseCSV,
  parseMarkdown,
  parseJSON,
  parseText,
  parsePDF,
  parseImage,
} from "./parsers";

/**
 * Configuration for supported file types
 * Add new file types here along with their parsers
 */
export const FILE_TYPES: FileTypeConfig[] = [
  {
    extensions: [".xlsx", ".xls"],
    mimeTypes: ["spreadsheet", "excel", "vnd.openxmlformats", "vnd.ms-excel"],
    parser: parseExcel,
  },
  {
    extensions: [".csv"],
    mimeTypes: ["text/csv", "csv"],
    parser: parseCSV,
  },
  {
    extensions: [".md"],
    mimeTypes: ["text/markdown", "markdown"],
    parser: parseMarkdown,
  },
  {
    extensions: [".json"],
    mimeTypes: ["application/json", "json"],
    parser: parseJSON,
  },
  {
    extensions: [".txt"],
    mimeTypes: ["text/plain"],
    parser: parseText,
  },
  {
    extensions: [".pdf"],
    mimeTypes: ["application/pdf", "pdf"],
    parser: parsePDF,
  },
  {
    extensions: [".png", ".jpg", ".jpeg", ".webp"],
    mimeTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp"],
    parser: (buffer: Buffer, filename: string) => parseImage(buffer, filename, ""),
  },
];

/**
 * Maximum file size in MB
 */
export const MAX_FILE_SIZE_MB = 500;

/**
 * Maximum number of files per upload
 */
export const MAX_FILES_PER_UPLOAD = 2;
