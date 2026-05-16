import type { PlanTask } from "../types/core";
import { parseSourceSelectionId, type SourceSelectionId } from "../types/sourceSelection";
import logger from "./logger";

export type PlanningResult = {
  currentObjective: string;
  plan: Array<PlanTask>;
  /** True when every parse strategy failed and the result is a synthetic
   *  fallback. Callers in "next" mode treat this as terminal so the
   *  conversation doesn't fabricate a continuation. */
  extractionFailed?: boolean;
};

function normalizeSources(value: unknown): SourceSelectionId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sources = value
    .map((source) => parseSourceSelectionId(source))
    .filter((source): source is SourceSelectionId => Boolean(source));
  return sources.length > 0 ? sources : undefined;
}

/**
 * Extract planning result from LLM response using multiple strategies.
 * Never throws - always returns a usable result.
 */
export function extractPlanningResult(
  rawContent: string,
  fallbackObjective?: string
): PlanningResult {
  let method = "unknown";

  // Strategy 1: Direct parse
  try {
    const result = JSON.parse(rawContent) as PlanningResult;
    method = "direct";
    logExtractionResult(method, true, result.plan?.length || 0);
    return normalizeResult(result);
  } catch {}

  // Strategy 2: Extract from markdown code block
  const codeBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch?.[1]) {
    try {
      const result = JSON.parse(codeBlockMatch[1]) as PlanningResult;
      method = "code_block";
      logExtractionResult(method, true, result.plan?.length || 0);
      return normalizeResult(result);
    } catch {}
  }

  // Strategy 3: Find largest JSON object that looks like a planning result
  const jsonObjects = rawContent.match(/\{[\s\S]*\}/g);
  if (jsonObjects) {
    // Sort by length descending, try largest first
    const sorted = jsonObjects.sort((a, b) => b.length - a.length);
    for (const jsonStr of sorted) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.plan || parsed.currentObjective) {
          method = "json_match";
          logExtractionResult(method, true, parsed.plan?.length || 0);
          return normalizeResult(parsed as PlanningResult);
        }
      } catch {}
    }
  }

  // Strategy 4: Field-by-field regex extraction
  const extracted = extractFieldsWithRegex(rawContent);
  if (extracted.plan.length > 0 || extracted.currentObjective) {
    method = "regex";
    logExtractionResult(method, true, extracted.plan.length);
    return extracted;
  }

  // Strategy 5: Return minimal default with fallback objective
  method = "default";
  const defaultResult: PlanningResult = {
    currentObjective: fallbackObjective || "Continue research based on user query",
    extractionFailed: true,
    plan: fallbackObjective
      ? [
          {
            datasets: [],
            level: 1,
            objective: fallbackObjective,
            output: "",
            type: "LITERATURE" as const,
          },
        ]
      : [],
  };

  logger.error(
    { rawContentPreview: rawContent.substring(0, 500) },
    "planning_json_extraction_failed_using_default"
  );
  logExtractionResult(method, false, defaultResult.plan.length);

  return defaultResult;
}

/**
 * Extract planning fields using regex patterns
 */
function extractFieldsWithRegex(content: string): PlanningResult {
  const result: PlanningResult = {
    currentObjective: "",
    plan: [],
  };

  // Extract currentObjective
  const objectiveMatch = content.match(/"currentObjective"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  if (objectiveMatch?.[1]) {
    result.currentObjective = objectiveMatch[1].replace(/\\"/g, '"');
  }

  // Extract plan tasks - look for LITERATURE or ANALYSIS task patterns
  const taskPattern =
    /"type"\s*:\s*"(LITERATURE|ANALYSIS)"[\s\S]*?"objective"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let match;
  while ((match = taskPattern.exec(content)) !== null) {
    const task: PlanTask = {
      datasets: [],
      level: result.plan.length + 1,
      objective: match[2]?.replace(/\\"/g, '"') || "",
      output: "",
      type: match[1] as "LITERATURE" | "ANALYSIS",
    };
    result.plan.push(task);
  }

  return result;
}

/**
 * Normalize result to ensure all required fields exist
 */
function normalizeResult(result: Partial<PlanningResult>): PlanningResult {
  return {
    currentObjective: result.currentObjective || "",
    plan: (result.plan || []).map((task, index) => ({
      ...task,
      datasets: task.datasets || [],
      level: task.level ?? index + 1,
      objective: task.objective || "",
      output: task.output || "",
      sources: normalizeSources(task.sources),
      type: task.type || "LITERATURE",
    })),
  };
}

/**
 * Log extraction result for monitoring
 */
function logExtractionResult(method: string, success: boolean, planTaskCount: number): void {
  logger.info({ method, planTaskCount, success }, "planning_json_extraction_result");
}
