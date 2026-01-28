import type { BioLiteratureMode } from ".";
import { fetchWithRetry } from "../../utils/fetchWithRetry";
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
  response?: {
    formatted_answer?: string;
    answer?: string;
    references?: BioReference[];
    context_passages?: BioContextPassage[];
    [key: string]: unknown;
  };
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
  const directResponse = data.response;
  const nestedResponse = data.output?.response;

  const directFormatted =
    typeof directResponse?.formatted_answer === "string"
      ? directResponse.formatted_answer.trim()
      : "";
  const directAnswer =
    typeof directResponse?.answer === "string"
      ? directResponse.answer.trim()
      : "";
  const nestedFormatted =
    typeof nestedResponse?.formatted_answer === "string"
      ? nestedResponse.formatted_answer.trim()
      : "";
  const nestedAnswer =
    typeof nestedResponse?.answer === "string"
      ? nestedResponse.answer.trim()
      : "";
  const dataFormatted =
    typeof data.formatted_answer === "string"
      ? data.formatted_answer.trim()
      : "";
  const dataAnswer = typeof data.answer === "string" ? data.answer.trim() : "";

  const answer =
    directFormatted ||
    directAnswer ||
    nestedFormatted ||
    nestedAnswer ||
    dataFormatted ||
    dataAnswer ||
    "";

  // this is debugging purposes
  logger.debug(
    {
      directFormattedLength: directFormatted.length,
      directAnswerLength: directAnswer.length,
      nestedFormattedLength: nestedFormatted.length,
      nestedAnswerLength: nestedAnswer.length,
      dataFormattedLength: dataFormatted.length,
      dataAnswerLength: dataAnswer.length,
      chosenAnswerLength: answer.length,
      hasResponse: Boolean(directResponse),
      hasNestedResponse: Boolean(nestedResponse),
    },
    "bioliterature_extract_answer_debug",
  );

  return answer;
}

function extractReferences(data: BioLiteratureResponse): BioReference[] {
  if (Array.isArray(data.references)) return data.references;
  const directReferences = data.response?.references;
  if (Array.isArray(directReferences)) return directReferences;
  const nestedReferences = data.output?.response?.references;
  if (Array.isArray(nestedReferences)) return nestedReferences;
  return [];
}

function extractContextPassages(
  data: BioLiteratureResponse,
): BioContextPassage[] {
  if (Array.isArray(data.context_passages)) return data.context_passages;
  const directPassages = data.response?.context_passages;
  if (Array.isArray(directPassages)) return directPassages;
  const nestedPassages = data.output?.response?.context_passages;
  if (Array.isArray(nestedPassages)) return nestedPassages;
  return [];
}

async function pollBioLiteratureJob(
  baseUrl: string,
  apiKey: string,
  jobId: string,
): Promise<BioLiteratureResponse> {
  const timeoutMinutes = parseInt(
    process.env.BIO_LITERATURE_TASK_TIMEOUT_MINUTES || "60",
    10,
  );
  const MAX_WAIT_TIME = timeoutMinutes * 60 * 1000;
  const POLL_INTERVAL = 10000; // 10 seconds
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > MAX_WAIT_TIME) {
      throw new Error(
        `BioLiterature job ${jobId} timed out after ${timeoutMinutes} minutes`,
      );
    }

    const { response } = await fetchWithRetry(
      `${baseUrl}/query/jobs/${jobId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
      },
      {
        onRetry: (attempt, error) =>
          logger.warn({ attempt, jobId, error: error.message }, "bioliterature_poll_retry"),
      },
    );

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

    logger.info(
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
): Promise<{ output: string; jobId?: string }> {
  logger.info({ BIO_LIT_AGENT_API_KEY, BIO_LIT_AGENT_API_URL });
  if (!BIO_LIT_AGENT_API_URL || !BIO_LIT_AGENT_API_KEY) {
    throw new Error("BioLiterature API URL or API key not configured");
  }

  logger.info({ objective }, "starting_bioliterature_search");

  const baseUrl = BIO_LIT_AGENT_API_URL.replace(/\/$/, "");
  const endpoint = `${baseUrl}/query`;

  const { response } = await fetchWithRetry(
    endpoint,
    {
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
    },
    {
      onRetry: (attempt, error) =>
        logger.warn({ attempt, objective, error: error.message }, "bioliterature_search_retry"),
    },
  );

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

    logger.info({ jobId }, "bioliterature_job_id");

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
    return {
      output: "No answer received from BioLiterature API",
      jobId,
    };
  }

  return {
    output: answer,
    jobId,
  };
}
