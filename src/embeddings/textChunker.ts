import { CONFIG } from "./config";

export interface Chunk {
  title: string;
  content: string;
  metadata: any;
  chunkIndex: number;
  totalChunks: number;
}

export class TextChunker {
  constructor(
    private maxChunkSize: number = CONFIG.CHUNK_SIZE,
    private overlapSize: number = CONFIG.CHUNK_OVERLAP,
  ) {}

  chunkDocument(doc: {
    title: string;
    content: string;
    metadata: any;
  }): Chunk[] {
    const text = doc.content;

    // If document is small enough, return as single chunk
    if (text.length <= this.maxChunkSize) {
      return [
        {
          title: doc.title,
          content: text,
          metadata: {
            ...doc.metadata,
            isFullDocument: true,
            chunkIndex: 0,
            totalChunks: 1,
          },
          chunkIndex: 0,
          totalChunks: 1,
        },
      ];
    }

    const chunks: Chunk[] = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      const end = Math.min(start + this.maxChunkSize, text.length);

      // Try to break at natural boundaries
      let actualEnd = end;
      if (end < text.length) {
        const boundaries = [
          text.lastIndexOf("\n\n", end), // Paragraph break
          text.lastIndexOf("\n", end), // Line break
          text.lastIndexOf(". ", end), // Sentence end
          text.lastIndexOf(" ", end), // Word boundary
        ];

        const bestBoundary = boundaries.find(
          (pos) => pos > start + this.maxChunkSize * 0.5,
        );
        if (bestBoundary && bestBoundary > start) {
          actualEnd = bestBoundary + (text[bestBoundary] === "." ? 2 : 1);
        }
      }

      const chunkContent = text.slice(start, actualEnd).trim();
      if (chunkContent) {
        chunks.push({
          title: doc.title,
          content: chunkContent,
          metadata: {
            ...doc.metadata,
            chunkStart: start,
            chunkEnd: actualEnd,
            isChunk: true,
            chunkIndex,
            totalChunks: 0, // Will be updated after all chunks are created
          },
          chunkIndex,
          totalChunks: 0, // Will be updated after all chunks are created
        });
      }

      start = Math.max(actualEnd - this.overlapSize, actualEnd);
      chunkIndex++;
    }

    // Update total chunks count in metadata
    chunks.forEach((chunk) => {
      chunk.totalChunks = chunks.length;
      chunk.metadata.totalChunks = chunks.length;
    });

    return chunks;
  }
}
