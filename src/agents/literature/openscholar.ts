import logger from "../../utils/logger";
import type { LiteratureResult } from "../../utils/literature";

interface OpenScholarChunk {
  reranker_score: number;
  paper_id: string;
  chunk_id: string;
  text: string;
  title: string;
}

/**
 * Search OpenScholar for relevant literature
 */
export async function searchOpenScholar(
  objective: string,
): Promise<LiteratureResult> {
  const endpoint = process.env.OPENSCHOLAR_API_URL || "";
  const apiKey = process.env.OPENSCHOLAR_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error("OpenScholar API URL or API key not configured");
  }

  // Fetch chunks for the objective
  const chunks = await fetchOpenScholarChunks(objective, endpoint, apiKey);

  // Format output
  const papers = chunks.map((chunk) => ({
    title: chunk.title,
    doi: `https://doi.org/${chunk.paper_id}`,
    text: chunk.text,
  }));

  const output =
    papers.length === 0
      ? `Found 0 relevant papers from OpenScholar (no results)`
      : `Found ${papers.length} relevant papers from OpenScholar:\n\n${papers
          .map(
            (p, idx) =>
              `${idx + 1}. ${p.title}\n   DOI: ${p.doi}\n   Excerpt: ${p.text.substring(0, 200)}...`,
          )
          .join("\n\n")}`;

  logger.info({ paperCount: papers.length }, "openscholar_search_completed");

  return {
    output,
    count: papers.length,
  };
}

/**
 * Fetch chunks from OpenScholar API
 */
async function fetchOpenScholarChunks(
  question: string,
  endpoint: string,
  apiKey: string,
  finalTopk: number = 10,
): Promise<OpenScholarChunk[]> {
  const body = {
    query: question,
    initial_topk: 400,
    keep_for_rerank: 80,
    final_topk: finalTopk,
    per_paper_cap: 3,
    boost_mode: "mul",
    boost_lambda: 0.1,
    max_length: 512,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenScholar API error ${res.status}: ${errorText}`);
  }

  const json = (await res.json()) as {
    query: string;
    results_count: number;
    processing_time: number;
    results: OpenScholarChunk[];
  };

  const chunks = Array.isArray(json.results)
    ? json.results.filter((chunk) => chunk.reranker_score > 0)
    : [];

  return chunks;
}
