import logger from "../../utils/logger";
import { analyzeWithBio } from "./bio";
import { analyzeWithEdison } from "./edison";
import type { AnalysisResult, Dataset } from "./types";

export type { AnalysisResult, Dataset } from "./types";

type AnalysisType = "EDISON" | "BIO";

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
