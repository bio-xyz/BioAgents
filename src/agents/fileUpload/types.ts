/**
 * Type definitions for file upload and parsing
 */

export type ParsedFile = {
  filename: string;
  mimeType: string;
  text: string;
  metadata?: Record<string, any>;
};

export type ParserFunction = (
  buffer: Buffer,
  filename: string
) => Promise<ParsedFile>;

export interface FileTypeConfig {
  extensions: string[];
  mimeTypes: string[];
  parser: ParserFunction;
}
