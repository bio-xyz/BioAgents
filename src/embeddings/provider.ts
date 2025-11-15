import OpenAI from "openai";
import { CONFIG } from "./config";

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  getDimensions(): number;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;

  constructor() {
    // Use Featherless if configured, otherwise fall back to OpenAI
    const apiKey = CONFIG.EMBEDDING_PROVIDER === "featherless"
      ? CONFIG.FEATHERLESS_API_KEY
      : CONFIG.OPENAI_API_KEY;
    
    if (!apiKey) {
      const keyName = CONFIG.EMBEDDING_PROVIDER === "featherless"
        ? "FEATHERLESS_API_KEY"
        : "OPENAI_API_KEY";
      throw new Error(`${keyName} is not configured for embeddings.`);
    }

    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey,
    };

    // Set baseUrl for Featherless
    if (CONFIG.EMBEDDING_PROVIDER === "featherless") {
      clientOptions.baseURL = "https://api.featherless.ai/v1";
    }

    this.client = new OpenAI(clientOptions);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: CONFIG.TEXT_EMBEDDING_MODEL,
      input: text,
      encoding_format: "float",
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
