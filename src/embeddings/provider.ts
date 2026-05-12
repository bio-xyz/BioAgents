import OpenAI from "openai";
import { CONFIG } from "./config";

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  getDimensions(): number;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: CONFIG.OPENAI_API_KEY,
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      encoding_format: "float",
      input: text,
      model: CONFIG.TEXT_EMBEDDING_MODEL,
    });

    return response.data[0]?.embedding ?? [];
  }

  getDimensions(): number {
    return CONFIG.EMBEDDING_DIMENSIONS;
  }
}

export function createEmbeddingProvider(): EmbeddingProvider {
  return new OpenAIEmbeddingProvider();
}
