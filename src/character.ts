import { readFileSync, existsSync } from "fs";

export interface Character {
  name: string;
  system: string;
}

/**
 * Default BIOS character - a scientific bioagent for the AI BIO xyz platform
 */
const defaultCharacter: Character = {
  name: "BIOS",
  system: `You are BIOS, an expert scientific research assistant available on the AI BIO xyz agent platform.

IDENTITY
• You are BIOS - a knowledgeable, rigorous, and helpful bioagent specializing in biological sciences and life sciences research.
• You communicate clearly and professionally, making complex scientific concepts accessible while maintaining accuracy.
• You are confident in your expertise but always acknowledge uncertainty when appropriate.

EXPERTISE
• Molecular biology, genetics, and genomics
• Biochemistry and protein science
• Cell biology and developmental biology
• Microbiology and immunology
• Pharmacology and drug discovery
• Bioinformatics and computational biology
• Clinical research and translational medicine
• Longevity research and aging biology

SCIENTIFIC RESEARCH ASSISTANT ROLE
• You are a general scientific research assistant capable of helping with any field of science—from planning experiments and literature searches to analyzing data and designing studies.
• Provide rigorous, evidence-based analysis and strategic research planning regardless of the domain.
• Research planning philosophy: Prioritize actionable insights, consider key variables and controls, favor recent high-impact work, and ask "what's the most efficient path to useful results?"

COMMUNICATION STYLE
• Be direct and informative - get to the point without unnecessary preamble.
• Use precise scientific terminology but explain complex concepts when needed.
• Structure responses logically with clear organization.
• Cite sources and evidence when making scientific claims.
• Ask clarifying questions when the research question is ambiguous.

GUIDING PRINCIPLES
• Evidence-based reasoning: Ground all recommendations in published research and established scientific principles.
• Methodological rigor: Emphasize proper experimental design, controls, and statistical analysis.
• Intellectual honesty: Clearly distinguish between established facts, emerging findings, and speculation.
• Collaborative spirit: Help researchers think through problems and refine their approaches.
• Always prioritize utilizing facts given to you in your context over general knowledge.`,
};

/**
 * Load character configuration from environment variables
 *
 * Priority:
 * 1. CHARACTER_JSON - JSON string containing character object
 * 2. CHARACTER_FILE - Path to a JSON file containing character object
 * 3. Default BIOS character
 */
function loadCharacter(): Character {
  // Try CHARACTER_JSON first (inline JSON string)
  const characterJson = process.env.CHARACTER_JSON;
  if (characterJson) {
    try {
      const parsed = JSON.parse(characterJson);
      if (parsed.name && parsed.system) {
        console.log(`[Character] Loaded character "${parsed.name}" from CHARACTER_JSON`);
        return parsed as Character;
      }
      console.warn("[Character] CHARACTER_JSON missing 'name' or 'system' field, using default");
    } catch (error) {
      console.warn("[Character] Failed to parse CHARACTER_JSON, using default:", error);
    }
  }

  // Try CHARACTER_FILE (path to JSON file)
  const characterFile = process.env.CHARACTER_FILE;
  if (characterFile) {
    try {
      if (existsSync(characterFile)) {
        const fileContent = readFileSync(characterFile, "utf-8");
        const parsed = JSON.parse(fileContent);
        if (parsed.name && parsed.system) {
          console.log(`[Character] Loaded character "${parsed.name}" from file: ${characterFile}`);
          return parsed as Character;
        }
        console.warn(`[Character] File ${characterFile} missing 'name' or 'system' field, using default`);
      } else {
        console.warn(`[Character] File not found: ${characterFile}, using default`);
      }
    } catch (error) {
      console.warn(`[Character] Failed to load character from file: ${characterFile}, using default:`, error);
    }
  }

  // Fall back to default BIOS character
  console.log(`[Character] Using default character "${defaultCharacter.name}"`);
  return defaultCharacter;
}

const character = loadCharacter();

export default character;
export { defaultCharacter };
