import logger from "../../utils/logger";
import { searchBioLiterature } from "./bio";
import { searchEdison } from "./edison";
import { searchKnowledge } from "./knowledge";
import { searchOpenScholar } from "./openscholar";

type LiteratureType =
  | "OPENSCHOLAR"
  | "KNOWLEDGE"
  | "EDISON"
  | "BIOLIT"
  | "BIOLITDEEP";

export type BioLiteratureMode = "fast" | "deep";

type LiteratureResult = {
  objective: string;
  output: string;
  count?: number;
  jobId?: string; // Job ID from Edison or BioLit
  start: string;
  end: string;
};

/**
 * Literature agent for deep research
 * Independent agent that searches literature without modifying state
 *
 * Flow:
 * 1. Convert objective to literature query
 * 2. Search literature based on type:
 *    - OPENSCHOLAR: Search academic papers via OpenScholar API
 *    - KNOWLEDGE: Search local knowledge base via vector search
 *    - EDISON: Deep search via Edison AI agent
 *    - BIOLIT: Search via BioLiterature API
 * 3. Return results with timing information
 */
export async function literatureAgent(input: {
  objective: string;
  type: LiteratureType;
}): Promise<LiteratureResult> {
  const { objective, type } = input;
  const start = new Date().toISOString();

  logger.info({ objective, type }, "literature_agent_started");

  let output: string;
  let count: number | undefined;
  let jobId: string | undefined;

  try {
    switch (type) {
      case "OPENSCHOLAR": {
        const result = await searchOpenScholar(objective);
        output = result.output;
        count = result.count;
        break;
      }
      case "KNOWLEDGE": {
        const result = await searchKnowledge(objective);
        output = result.output;
        count = result.count;
        break;
      }
      case "BIOLIT": {
        const result = await searchBioLiterature(objective, "fast");
        output = result.output;
        jobId = result.jobId;
        break;
      }
      case "BIOLITDEEP": {
        const result = await searchBioLiterature(objective, "deep");
        output = result.output;
        jobId = result.jobId;
        break;
      }
      case "EDISON": {
        const result = await searchEdison(
          objective +
            "/n/nMANDATORY: Make sure that the final literature search result is returned along with inline citations for each claim made in the result. MANDATORY FORMAT: Each claim should be in the following format: (claim goes in the parentheses)[DOI] or (claim goes in the parentheses)[URL]. If there are general statements, it is alright to not include citations for them. DOI URL is totally enough, you don't need to include formats like [pelaezvico2025integrativeanalysisof pages 1-4].\n\nMANDATORY CITATION COUNT: Do your absolute best to cite at least 5 sources in your answer.",
        );
        output = result.output;
        jobId = result.jobId;
        break;
      }
      default:
        throw new Error(`Unknown literature type: ${type}`);
    }
  } catch (err) {
    logger.error({ err, objective, type }, "literature_agent_failed");
    output = `Error searching literature: ${err instanceof Error ? err.message : "Unknown error"}`;
  }

  const end = new Date().toISOString();

  logger.info(
    { objective, type, outputLength: output.length, count },
    "literature_agent_completed",
  );

  return {
    objective,
    output,
    count,
    jobId,
    start,
    end,
  };
}
