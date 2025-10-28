/**
 * File type detection utilities for the reply tool
 */

export interface FileInfo {
  buffer?: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Checks if a file is a PDF
 */
export function isPDF(file: FileInfo): boolean {
  return (
    file.mimeType?.includes('pdf') ||
    file.filename?.toLowerCase().endsWith('.pdf')
  );
}

/**
 * Checks if a file is a data file (CSV, Excel)
 */
export function isDataFile(file: FileInfo): boolean {
  const mimeType = file.mimeType?.toLowerCase() || '';
  const filename = file.filename?.toLowerCase() || '';

  return (
    mimeType.includes('csv') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    filename.endsWith('.csv') ||
    filename.endsWith('.xlsx') ||
    filename.endsWith('.xls')
  );
}

/**
 * Checks if a file is an image
 */
export function isImage(file: FileInfo): boolean {
  const mimeType = file.mimeType?.toLowerCase() || '';
  const filename = file.filename?.toLowerCase() || '';

  return (
    mimeType.includes('image') ||
    filename.endsWith('.jpg') ||
    filename.endsWith('.jpeg') ||
    filename.endsWith('.png') ||
    filename.endsWith('.gif') ||
    filename.endsWith('.webp')
  );
}

/**
 * Detects file types from an array of files
 */
export function detectFileTypes(files: FileInfo[] | undefined) {
  if (!files || files.length === 0) {
    return {
      hasPDF: false,
      hasDataFile: false,
      hasImage: false,
      fileCount: 0,
    };
  }

  return {
    hasPDF: files.some(isPDF),
    hasDataFile: files.some(isDataFile),
    hasImage: files.some(isImage),
    fileCount: files.length,
  };
}
