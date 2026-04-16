import matter from "front-matter";
import fs from "fs/promises";
import mammoth from "mammoth";
import path from "path";
import { PDFParse } from "pdf-parse";
import logger from "../utils/logger";

export interface ProcessedDocument {
  title: string;
  content: string;
  metadata: {
    filePath: string;
    type: string;
    size: number;
    lastModified: Date;
    [key: string]: unknown;
  };
}

export class DocumentProcessor {
  async processFile(filePath: string): Promise<ProcessedDocument | null> {
    const stats = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath); // Keep extension in filename

    let content: string;
    let frontMatterData: Record<string, unknown> = {};

    try {
      switch (ext) {
        case ".md":
          const rawContent = await fs.readFile(filePath, "utf-8");
          const parsed = matter<Record<string, unknown>>(rawContent);
          frontMatterData =
            parsed.attributes && typeof parsed.attributes === "object"
              ? parsed.attributes
              : {};
          content = parsed.body;
          break;

        case ".docx":
          const buffer = await fs.readFile(filePath);
          const result = await mammoth.extractRawText({ buffer });
          content = result.value;
          break;

        case ".pdf":
          try {
            const parser = new PDFParse({ url: filePath });
            const pdfResult = await parser.getText();
            await parser.destroy();
            content = pdfResult.text;
          } catch (pdfError: unknown) {
            const message =
              pdfError instanceof Error ? pdfError.message : String(pdfError);
            logger.error(`PDF parsing error for ${fileName}: ${message}`);
            throw new Error(`Failed to parse PDF ${fileName}: ${message}`);
          }
          break;

        default:
          logger.warn(`Unsupported file type: ${ext}`);
          return null;
      }

      return {
        title: fileName,
        content: content.trim(),
        metadata: {
          filePath,
          type: ext.slice(1),
          size: stats.size,
          lastModified: stats.mtime,
          ...frontMatterData,
        },
      };
    } catch (error) {
      logger.error({ err: error }, `Error processing ${filePath}`);
      return null;
    }
  }

  async processDirectory(dirPath: string): Promise<ProcessedDocument[]> {
    const documents: ProcessedDocument[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively process subdirectories
          const subDocs = await this.processDirectory(fullPath);
          documents.push(...subDocs);
        } else if (entry.isFile()) {
          const doc = await this.processFile(fullPath);
          if (doc) {
            documents.push(doc);
            logger.info(`✅ Processed: ${doc.title} (${doc.metadata.type})`);
          }
        }
      }
    } catch (error) {
      logger.error({ err: error }, `Error reading directory ${dirPath}`);
    }

    return documents;
  }
}
