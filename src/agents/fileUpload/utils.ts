/**
 * Utility functions for file upload and processing
 */

/**
 * Normalizes MIME type for comparison
 */
export function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().trim();
}

/**
 * Checks if MIME type matches any of the provided patterns
 */
export function matchesMimeType(mimeType: string, patterns: string[]): boolean {
  const normalized = normalizeMimeType(mimeType);
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

/**
 * Extracts file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.substring(lastDot).toLowerCase();
}

/**
 * Checks if filename has any of the provided extensions
 */
export function matchesExtension(filename: string, extensions: string[]): boolean {
  const lowerFilename = filename.toLowerCase();
  return extensions.some((ext) => lowerFilename.endsWith(ext));
}

/**
 * Formats file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Validates file size against a maximum limit (in bytes)
 */
export function isFileSizeValid(fileSize: number, maxSizeBytes: number): boolean {
  return fileSize <= maxSizeBytes;
}

/**
 * Converts file size from MB to bytes
 */
export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

/**
 * Sanitizes filename by removing unsafe characters
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-_]/g, '_');
}

/**
 * Wraps async parser execution with consistent error handling
 */
export async function wrapParserError<T>(
  parserName: string,
  parserFn: () => Promise<T>
): Promise<T> {
  try {
    return await parserFn();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${parserName}: ${errorMessage}`);
  }
}
