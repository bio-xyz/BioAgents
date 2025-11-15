export const CONFIG = {
  EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || "featherless",
  TEXT_EMBEDDING_MODEL:
    process.env.TEXT_EMBEDDING_MODEL || "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: 1536, // text-embedding-3-small
  CHUNK_SIZE: parseInt(process.env.CHUNK_SIZE || "2000", 10),
  CHUNK_OVERLAP: parseInt(process.env.CHUNK_OVERLAP || "200", 10),
  VECTOR_SEARCH_LIMIT: parseInt(process.env.VECTOR_SEARCH_LIMIT || "20", 10),
  RERANK_FINAL_LIMIT: parseInt(process.env.RERANK_FINAL_LIMIT || "5", 10),
  USE_RERANKING: process.env.USE_RERANKING !== "false", // default true
  SIMILARITY_THRESHOLD: parseFloat(
    process.env.SIMILARITY_THRESHOLD || "0.3",
  ),
  RERANKER_SCORE_THRESHOLD: parseFloat(
    process.env.RERANKER_SCORE_THRESHOLD || "0.0",
  ),
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
  // Support both Featherless and OpenAI API keys
  FEATHERLESS_API_KEY: process.env.FEATHERLESS_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  COHERE_API_KEY: process.env.COHERE_API_KEY!,
} as const;
