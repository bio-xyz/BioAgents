import logger from "../../utils/logger";

const BIO_LIT_AGENT_API_URL = process.env.BIO_LIT_AGENT_API_URL;
const BIO_LIT_AGENT_API_KEY = process.env.BIO_LIT_AGENT_API_KEY || "";

type BioLiteratureResponse = {
  answer?: string;
  formatted_answer?: string;
  references?: Array<{
    id?: number | string;
    paper_id?: string;
    title?: string;
    doi?: string;
    url?: string;
  }>;
  context_passages?: Array<{
    ref_id?: number | string;
    text?: string;
    source?: string;
    paper_id?: string;
  }>;
  results?: unknown;
  [key: string]: unknown;
};

export async function searchBioLiterature(objective: string): Promise<string> {
  logger.info({ BIO_LIT_AGENT_API_KEY, BIO_LIT_AGENT_API_URL });
  if (!BIO_LIT_AGENT_API_URL || !BIO_LIT_AGENT_API_KEY) {
    throw new Error("BioLiterature API URL or API key not configured");
  }

  logger.info({ objective }, "starting_bioliterature_search");

  const endpoint = `${BIO_LIT_AGENT_API_URL.replace(/\/$/, "")}/query`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": BIO_LIT_AGENT_API_KEY,
    },
    body: JSON.stringify({
      question: objective,
      max_results: 20,
      per_source_limit: 5,
      sources: ["arxiv", "pubmed", "clinical-trials"],
      mode: "fast",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `BioLiterature API error: ${response.status} - ${errorText}`,
    );
  }

  const data = (await response.json()) as BioLiteratureResponse;
  const answer =
    (typeof data.answer === "string" && data.answer.trim()) ||
    (typeof data.formatted_answer === "string" &&
      data.formatted_answer.trim()) ||
    "";

  logger.info(
    {
      hasAnswer: Boolean(answer),
      referencesCount: Array.isArray(data.references)
        ? data.references.length
        : 0,
      contextPassagesCount: Array.isArray(data.context_passages)
        ? data.context_passages.length
        : 0,
    },
    "bioliterature_search_completed",
  );

  if (!answer) {
    return "No answer received from BioLiterature API";
  }

  return answer;
}
