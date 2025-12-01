import logger from "../../utils/logger";
import { analyzeWithBio } from "./bio";
import { analyzeWithEdison } from "./edison";

type AnalysisType = "EDISON" | "BIO";

export type Dataset = {
  filename: string;
  id: string;
  description: string;
  content?: Buffer;
};

type AnalysisResult = {
  objective: string;
  output: string;
  start: string;
  end: string;
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
  const start = new Date().toISOString();

  logger.info(
    {
      objective,
      type,
      datasets: datasets.map((d) => `${d.filename} (${d.description})`),
    },
    "analysis_agent_started",
  );

  let output: string;

  try {
    switch (type) {
      case "EDISON":
        output = await analyzeWithEdison(
          objective,
          datasets,
          userId,
          conversationStateId,
        );
        break;
      case "BIO":
        output = await analyzeWithBio(
          objective,
          datasets,
          userId,
          conversationStateId,
        );
        break;
      default:
        throw new Error(`Unknown analysis type: ${type}`);
    }
  } catch (err) {
    logger.error({ err, objective, type }, "analysis_agent_failed");
    output = `Error performing analysis: ${err instanceof Error ? err.message : "Unknown error"}`;
  }

  const end = new Date().toISOString();

  logger.info(
    { objective, type, outputLength: output.length },
    "analysis_agent_completed",
  );

  return {
    objective,
    output,
    start,
    end,
  };
}
