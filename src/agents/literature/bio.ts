import type { BioLiteratureMode } from ".";
import logger from "../../utils/logger";

const BIO_LIT_AGENT_API_URL = process.env.BIO_LIT_AGENT_API_URL;
const BIO_LIT_AGENT_API_KEY = process.env.BIO_LIT_AGENT_API_KEY || "";

type BioReference = {
  id?: number | string;
  paper_id?: string;
  title?: string;
  doi?: string;
  url?: string;
};

type BioContextPassage = {
  ref_id?: number | string;
  text?: string;
  source?: string;
  paper_id?: string;
};

type BioLiteratureResponse = {
  answer?: string;
  formatted_answer?: string;
  references?: BioReference[];
  context_passages?: BioContextPassage[];
  results?: unknown;
  job_id?: string;
  status?: string;
  output?: {
    response?: {
      formatted_answer?: string;
      answer?: string;
      references?: BioReference[];
      context_passages?: BioContextPassage[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function extractAnswer(data: BioLiteratureResponse): string {
  const nestedResponse = data.output?.response;
  return (
    (typeof nestedResponse?.formatted_answer === "string" &&
      nestedResponse.formatted_answer.trim()) ||
    (typeof nestedResponse?.answer === "string" &&
      nestedResponse.answer.trim()) ||
    (typeof data.formatted_answer === "string" &&
      data.formatted_answer.trim()) ||
    (typeof data.answer === "string" && data.answer.trim()) ||
    ""
  );
}

function extractReferences(data: BioLiteratureResponse): BioReference[] {
  if (Array.isArray(data.references)) return data.references;
  const nestedReferences = data.output?.response?.references;
  if (Array.isArray(nestedReferences)) return nestedReferences;
  return [];
}

function extractContextPassages(
  data: BioLiteratureResponse,
): BioContextPassage[] {
  if (Array.isArray(data.context_passages)) return data.context_passages;
  const nestedPassages = data.output?.response?.context_passages;
  if (Array.isArray(nestedPassages)) return nestedPassages;
  return [];
}

async function pollBioLiteratureJob(
  baseUrl: string,
  apiKey: string,
  jobId: string,
): Promise<BioLiteratureResponse> {
  const MAX_WAIT_TIME = 15 * 60 * 1000; // 15 minutes
  const POLL_INTERVAL = 5000; // 5 seconds
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > MAX_WAIT_TIME) {
      throw new Error(
        `BioLiterature job ${jobId} timed out after 15 minutes`,
      );
    }

    const response = await fetch(`${baseUrl}/query/jobs/${jobId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `BioLiterature job polling error: ${response.status} - ${errorText}`,
      );
    }

    const jobData = (await response.json()) as BioLiteratureResponse;
    const status = String(
      jobData.status ||
        (jobData as { job_status?: string }).job_status ||
        (jobData as { state?: string }).state ||
        "",
    ).toLowerCase();

    const answer = extractAnswer(jobData);

    logger.debug(
      { jobId, status, hasAnswer: Boolean(answer) },
      "bioliterature_deep_poll",
    );

    if (status === "failed" || status === "error") {
      throw new Error(`BioLiterature job ${jobId} failed`);
    }

    // Treat either a completed status or the presence of an answer as a signal to stop polling
    if (
      answer ||
      status === "completed" ||
      status === "succeeded" ||
      status === "success" ||
      status === "finished" ||
      status === "done" ||
      status === "ready"
    ) {
      return jobData;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

export async function searchBioLiterature(
  objective: string,
  mode: BioLiteratureMode = "deep",
): Promise<string> {
  logger.info({ BIO_LIT_AGENT_API_KEY, BIO_LIT_AGENT_API_URL });
  if (!BIO_LIT_AGENT_API_URL || !BIO_LIT_AGENT_API_KEY) {
    throw new Error("BioLiterature API URL or API key not configured");
  }

  logger.info({ objective }, "starting_bioliterature_search");

  const baseUrl = BIO_LIT_AGENT_API_URL.replace(/\/$/, "");
  const endpoint = `${baseUrl}/query`;

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
      mode,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `BioLiterature API error: ${response.status} - ${errorText}`,
    );
  }

  const initialData = (await response.json()) as BioLiteratureResponse;
  let finalData: BioLiteratureResponse = initialData;
  let jobId: string | undefined;

  if (mode === "deep") {
    jobId = initialData.job_id ?? (initialData as { jobId?: string }).jobId;

    if (jobId) {
      logger.info({ jobId }, "bioliterature_deep_job_created");
      finalData = await pollBioLiteratureJob(
        baseUrl,
        BIO_LIT_AGENT_API_KEY,
        jobId,
      );
    } else {
      logger.warn(
        { mode },
        "bioliterature_deep_missing_job_id_using_direct_response",
      );
    }
  }

  const answer = extractAnswer(finalData);
  const references = extractReferences(finalData);
  const contextPassages = extractContextPassages(finalData);

  logger.info(
    {
      hasAnswer: Boolean(answer),
      referencesCount: references.length,
      contextPassagesCount: contextPassages.length,
      mode,
      jobId,
    },
    "bioliterature_search_completed",
  );

  if (!answer) {
    return "No answer received from BioLiterature API";
  }

  return answer;
}
