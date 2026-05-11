import type { OnPollUpdate } from "../../types/core";
import { fetchWithRetry } from "../../utils/fetchWithRetry";
import logger from "../../utils/logger";
import type { BioLiteratureMode } from ".";

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
  reasoning?: string[];
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
    typeof directResponse?.answer === "string" ? directResponse.answer.trim() : "";
  const nestedFormatted =
    typeof nestedResponse?.formatted_answer === "string"
      ? nestedResponse.formatted_answer.trim()
      : "";
  const nestedAnswer =
    typeof nestedResponse?.answer === "string" ? nestedResponse.answer.trim() : "";
  const dataFormatted =
    typeof data.formatted_answer === "string" ? data.formatted_answer.trim() : "";
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
      chosenAnswerLength: answer.length,
      dataAnswerLength: dataAnswer.length,
      dataFormattedLength: dataFormatted.length,
      directAnswerLength: directAnswer.length,
      directFormattedLength: directFormatted.length,
      hasNestedResponse: Boolean(nestedResponse),
      hasResponse: Boolean(directResponse),
      nestedAnswerLength: nestedAnswer.length,
      nestedFormattedLength: nestedFormatted.length,
    },
    "bioliterature_extract_answer_debug"
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

function extractContextPassages(data: BioLiteratureResponse): BioContextPassage[] {
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
  onPollUpdate?: OnPollUpdate
): Promise<BioLiteratureResponse> {
  const timeoutMinutes = parseInt(process.env.BIO_LITERATURE_TASK_TIMEOUT_MINUTES || "60", 10);
  const MAX_WAIT_TIME = timeoutMinutes * 60 * 1000;
  const POLL_INTERVAL = 10000; // 10 seconds
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > MAX_WAIT_TIME) {
      throw new Error(`BioLiterature job ${jobId} timed out after ${timeoutMinutes} minutes`);
    }

    const { response } = await fetchWithRetry(
      `${baseUrl}/query/jobs/${jobId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        method: "GET",
      },
      {
        onRetry: (attempt, error) =>
          logger.warn({ attempt, error: error.message, jobId }, "bioliterature_poll_retry"),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BioLiterature job polling error: ${response.status} - ${errorText}`);
    }

    const jobData = (await response.json()) as BioLiteratureResponse;
    const status = String(
      jobData.status ||
        (jobData as { job_status?: string }).job_status ||
        (jobData as { state?: string }).state ||
        ""
    ).toLowerCase();

    const answer = extractAnswer(jobData);

    // Invoke onPollUpdate with reasoning trace from this poll iteration
    const reasoning = Array.isArray(jobData.reasoning) ? jobData.reasoning : undefined;
    if (onPollUpdate && reasoning) {
      try {
        await onPollUpdate({ reasoning });
      } catch (err) {
        logger.warn({ err, jobId }, "bioliterature_on_poll_update_failed");
      }
    }

    logger.debug(
      { hasAnswer: Boolean(answer), hasReasoning: Boolean(reasoning), jobId, status },
      "bioliterature_deep_poll"
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
  onPollUpdate?: OnPollUpdate
): Promise<{ output: string; jobId?: string; reasoning?: string[] }> {
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
      body: JSON.stringify({
        max_results: 20,
        mode,
        per_source_limit: 5,
        question: objective,
        sources: ["arxiv", "pubmed", "clinical-trials"],
      }),
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": BIO_LIT_AGENT_API_KEY,
      },
      method: "POST",
    },
    {
      onRetry: (attempt, error) =>
        logger.warn({ attempt, error: error.message, objective }, "bioliterature_search_retry"),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BioLiterature API error: ${response.status} - ${errorText}`);
  }

  const initialData = (await response.json()) as BioLiteratureResponse;
  let finalData: BioLiteratureResponse = initialData;
  let jobId: string | undefined;

  if (mode === "deep") {
    jobId = initialData.job_id ?? (initialData as { jobId?: string }).jobId;

    logger.info({ jobId }, "bioliterature_job_id");

    if (jobId) {
      logger.info({ jobId }, "bioliterature_deep_job_created");
      finalData = await pollBioLiteratureJob(baseUrl, BIO_LIT_AGENT_API_KEY, jobId, onPollUpdate);
    } else {
      logger.warn({ mode }, "bioliterature_deep_missing_job_id_using_direct_response");
    }
  }

  const answer = extractAnswer(finalData);
  const references = extractReferences(finalData);
  const contextPassages = extractContextPassages(finalData);
  const finalReasoning = Array.isArray(finalData.reasoning) ? finalData.reasoning : undefined;

  logger.info(
    {
      contextPassagesCount: contextPassages.length,
      hasAnswer: Boolean(answer),
      jobId,
      mode,
      referencesCount: references.length,
    },
    "bioliterature_search_completed"
  );

  if (!answer) {
    return {
      jobId,
      output: "No answer received from BioLiterature API",
      reasoning: finalReasoning,
    };
  }

  return {
    jobId,
    output: answer,
    reasoning: finalReasoning,
  };
}
