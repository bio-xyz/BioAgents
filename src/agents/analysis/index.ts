import type { AnalysisArtifact } from "../../types/core";
import logger from "../../utils/logger";
import { analyzeWithBio } from "./bio";
import { analyzeWithEdison } from "./edison";

type AnalysisType = "EDISON" | "BIO";

export type Dataset = {
  filename: string;
  id: string;
  description: string;
  content?: Buffer;
  path?: string;
};

export type AnalysisResult = {
  objective: string;
  output: string;
  jobId?: string; // Edison task_id or Bio task id
  start?: string;
  end?: string;
  artifacts?: Array<AnalysisArtifact>;
};

/**
 * Analysis agent for deep research
 * Independent agent that performs data analysis without modifying state
 *
 * Flow:
 * 1. Take objective and datasets (can be multiple)
 * 2. Run analysis based on type:
 *    - EDISON: Deep analysis via Edison AI agent
 *    - BIO: Basic analysis via Bio Data Analysis agent
 * 3. Return results with timing information
 */
export async function analysisAgent(input: {
  objective: string;
  datasets: Dataset[];
  type: AnalysisType;
  userId: string;
  conversationStateId: string;
}): Promise<AnalysisResult> {
  const { objective, datasets, type, userId, conversationStateId } = input;
  let result: AnalysisResult = {
    objective,
    start: new Date().toISOString(),
    output: "",
    artifacts: [],
  };

  logger.info(
    {
      objective,
      type,
      datasets: datasets.map((d) => `${d.filename} (${d.description})`),
    },
    "analysis_agent_started",
  );

  try {
    switch (type) {
      case "EDISON": {
        const { output, jobId } = await analyzeWithEdison(
          objective,
          datasets,
          userId,
          conversationStateId,
        );
        result.output = output;
        result.jobId = jobId;
        break;
      }
      case "BIO": {
        const { output, artifacts, jobId } = await analyzeWithBio(
          objective,
          datasets,
          userId,
          conversationStateId,
        );
        result.output = output;
        result.artifacts = artifacts;
        result.jobId = jobId;
        break;
      }
      default:
        throw new Error(`Unknown analysis type: ${type}`);
    }
  } catch (err) {
    logger.error({ err, objective, type }, "analysis_agent_failed");
    result.output = `Error performing analysis: ${err instanceof Error ? err.message : "Unknown error"}`;
  }

  result.end = new Date().toISOString();

  logger.info(
    { objective, type, outputLength: result.output.length },
    "analysis_agent_completed",
  );

  return result;
}
