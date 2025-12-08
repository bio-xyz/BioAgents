import logger from "../../utils/logger";
import { searchEdison } from "./edison";
import { searchBioLiterature } from "./bioLiteratureApi";
import { searchKnowledge } from "./knowledge";
import { searchOpenScholar } from "./openscholar";

type LiteratureType = "OPENSCHOLAR" | "KNOWLEDGE" | "EDISON" | "BIOLIT";

type LiteratureResult = {
  objective: string;
  output: string;
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

  try {
    switch (type) {
      case "OPENSCHOLAR":
        output = await searchOpenScholar(objective);
        break;
      case "KNOWLEDGE":
        output = await searchKnowledge(objective);
        break;
      case "BIOLIT":
        output = await searchBioLiterature(objective);
        break;
      case "EDISON":
        output = await searchEdison(
          objective +
            "/n/nMANDATORY: Make sure that the final literature search result is returned along with inline citations for each claim made in the result. MANDATORY: Each claim should be in the following format: (claim)[DOI] or (claim)[URL]. If there are general statements, it is alright to not include citations for them.",
        );
        break;
      default:
        throw new Error(`Unknown literature type: ${type}`);
    }
  } catch (err) {
    logger.error({ err, objective, type }, "literature_agent_failed");
    output = `Error searching literature: ${err instanceof Error ? err.message : "Unknown error"}`;
  }

  const end = new Date().toISOString();

  logger.info(
    { objective, type, outputLength: output.length },
    "literature_agent_completed",
  );

  return {
    objective,
    output,
    start,
    end,
  };
}
