import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { LLM } from "../../llm/provider";
import type { LLMProvider as LLMProviderConfig } from "../../llm/types";
import type {
  ConversationStateValues,
  DeepResearchObjectiveTrace,
} from "../../types/core";
import logger from "../logger";

export const OBJECTIVE_TRACE_REVEAL_INTERVAL_MS = 60_000;

const MIN_TRACE_STEPS = 5;
const MAX_TRACE_STEPS = 15;
const MAX_STEP_LENGTH = 80;

const DEFAULT_OPENAI_MODEL = "gpt-5.4-nano";
const DEFAULT_NON_OPENAI_MODEL = "gemini-2.5-flash";

const OBJECTIVE_TRACE_SYSTEM_PROMPT = [
  "You create short user-facing progress traces for a scientific deep research workflow.",
  "Do not reveal chain-of-thought or hidden reasoning.",
  "Return concise, high-level planning steps only.",
].join(" ");

const FALLBACK_TRACE_STEPS = [
  "Clarifying the objective",
  "Defining the research scope",
  "Mapping the evidence needs",
  "Selecting the key methods",
  "Gathering the relevant findings",
  "Comparing the reported results",
  "Synthesizing the main conclusions",
  "Drafting the final response",
];

const ObjectiveTraceSchema = z.object({
  steps: z.array(z.string()),
});

export function normalizeDeepResearchObjective(
  objective?: string,
): string | undefined {
  const trimmed = objective?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRunRootMessageId(
  runRootMessageId?: string,
): string | undefined {
  const trimmed = runRootMessageId?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStep(step: string): string {
  return step
    .replace(/^\s*[-*•]+\s*/, "")
    .replace(/^\s*\d+[\].:)\-]?\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[.;:,]+$/, "")
    .trim();
}

function sanitizeSteps(steps: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const rawStep of steps) {
    const step = normalizeStep(rawStep);
    if (!step) {
      continue;
    }

    const wordCount = step.split(/\s+/).length;
    if (wordCount < 3 || wordCount > 8 || step.length > MAX_STEP_LENGTH) {
      continue;
    }

    const key = step.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    cleaned.push(step);
  }

  return cleaned;
}

function clampVisibleCount(trace: DeepResearchObjectiveTrace): number {
  return Math.min(trace.steps.length, Math.max(trace.visibleCount ?? 1, 1));
}

function validateTracePayload(payload: unknown): string[] | null {
  const parsed = ObjectiveTraceSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const cleanedSteps = sanitizeSteps(parsed.data.steps);
  if (
    cleanedSteps.length < MIN_TRACE_STEPS ||
    cleanedSteps.length > MAX_TRACE_STEPS
  ) {
    return null;
  }

  return cleanedSteps;
}

function extractJsonObject(content: string): unknown | null {
  const trimmed = content.trim();

  const candidates = [
    trimmed,
    trimmed.replace(/^```json\s*/i, "").replace(/\s*```$/, ""),
    trimmed.replace(/^```\s*/i, "").replace(/\s*```$/, ""),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function buildTracePrompt(objective: string, retry = false): string {
  return [
    "Break down the following deep research objective into a concise, sequential progress trace.",
    "",
    "Requirements:",
    "- Return 5 to 15 steps.",
    "- Each step must be 3 to 8 words.",
    "- Use action-oriented planning phrases.",
    "- Do not use numbering, bullets, markdown, or explanations.",
    "- Keep the steps distinct and sequential.",
    '- Avoid generic filler like "Thinking through the problem".',
    "- Keep the phrasing user-facing and high-level.",
    "",
    "Return JSON only in this exact shape:",
    '{"steps":["..."]}',
    "",
    retry
      ? "The previous output was invalid. Return only valid JSON with 5 to 15 unique steps."
      : "",
    "Objective:",
    objective,
  ]
    .filter(Boolean)
    .join("\n");
}

function getProviderCandidates(): Array<LLMProviderConfig["name"]> {
  const candidates: Array<LLMProviderConfig["name"] | undefined> = [
    process.env.OBJECTIVE_TRACE_LLM_PROVIDER as
      | LLMProviderConfig["name"]
      | undefined,
    process.env.OPENAI_API_KEY ? "openai" : undefined,
    process.env.PLANNING_LLM_PROVIDER as LLMProviderConfig["name"] | undefined,
    "google",
    "anthropic",
    "openrouter",
  ];

  const seen = new Set<string>();
  const uniqueCandidates: Array<LLMProviderConfig["name"]> = [];

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    uniqueCandidates.push(candidate);
  }

  return uniqueCandidates;
}

function getProviderConfig(): {
  providerName: LLMProviderConfig["name"];
  apiKey?: string;
  model: string;
  supportsStructuredOutput: boolean;
} {
  const providerName =
    getProviderCandidates().find(
      (candidate) => process.env[`${candidate.toUpperCase()}_API_KEY`],
    ) || "openai";

  const apiKey = process.env[`${providerName.toUpperCase()}_API_KEY`];
  const model =
    process.env.OBJECTIVE_TRACE_LLM_MODEL ||
    (providerName === "openai"
      ? DEFAULT_OPENAI_MODEL
      : process.env.PLANNING_LLM_MODEL || DEFAULT_NON_OPENAI_MODEL);

  return {
    providerName,
    apiKey,
    model,
    supportsStructuredOutput: providerName === "openai",
  };
}

async function requestObjectiveTraceSteps(
  objective: string,
  retry = false,
): Promise<string[] | null> {
  const { providerName, apiKey, model, supportsStructuredOutput } =
    getProviderConfig();

  if (!apiKey) {
    throw new Error(`${providerName.toUpperCase()}_API_KEY is not configured`);
  }

  const llmProvider = new LLM({
    name: providerName,
    apiKey,
  });

  const response = await llmProvider.createChatCompletion({
    model,
    messages: [
      {
        role: "user",
        content: buildTracePrompt(objective, retry),
      },
    ],
    systemInstruction: OBJECTIVE_TRACE_SYSTEM_PROMPT,
    maxTokens: 1600,
    ...(supportsStructuredOutput
      ? {
          format: zodTextFormat(ObjectiveTraceSchema, "objective_trace"),
        }
      : {}),
  });

  const payload = supportsStructuredOutput
    ? JSON.parse(response.content)
    : extractJsonObject(response.content);

  return validateTracePayload(payload);
}

async function generateTraceSteps(objective: string): Promise<string[]> {
  const normalizedObjective = normalizeDeepResearchObjective(objective);
  if (!normalizedObjective) {
    return [...FALLBACK_TRACE_STEPS];
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const steps = await requestObjectiveTraceSteps(
        normalizedObjective,
        attempt === 1,
      );

      if (steps) {
        return steps;
      }

      logger.warn(
        {
          objectivePreview: normalizedObjective.slice(0, 200),
          attempt: attempt + 1,
        },
        "objective_trace_invalid_payload",
      );
    } catch (error) {
      logger.warn(
        {
          error,
          objectivePreview: normalizedObjective.slice(0, 200),
          attempt: attempt + 1,
        },
        "objective_trace_generation_failed",
      );
    }
  }

  return [...FALLBACK_TRACE_STEPS];
}

export function getObjectiveTraceObjective(
  values: ConversationStateValues,
  fallbackObjective?: string,
): string | undefined {
  return normalizeDeepResearchObjective(
    values.currentObjective ||
      values.evolvingObjective ||
      values.objective ||
      fallbackObjective,
  );
}

export async function ensureObjectiveTrace(
  values: ConversationStateValues,
  objective?: string,
  options?: { runRootMessageId?: string },
): Promise<DeepResearchObjectiveTrace | undefined> {
  const normalizedObjective = normalizeDeepResearchObjective(objective);
  if (!normalizedObjective) {
    return values.objectiveTrace;
  }

  const currentRunRootMessageId = normalizeRunRootMessageId(
    options?.runRootMessageId || values.deepResearchRun?.rootMessageId,
  );
  const existingTrace = values.objectiveTrace;
  const existingRunRootMessageId = normalizeRunRootMessageId(
    existingTrace?.runRootMessageId,
  );
  const isSameRun =
    !currentRunRootMessageId ||
    (!!existingRunRootMessageId &&
      existingRunRootMessageId === currentRunRootMessageId);

  if (
    existingTrace &&
    normalizeDeepResearchObjective(existingTrace.objective) ===
      normalizedObjective &&
    isSameRun &&
    existingTrace.steps?.length
  ) {
    existingTrace.status = "active";
    existingTrace.visibleCount = clampVisibleCount(existingTrace);
    existingTrace.lastAdvancedAt =
      existingTrace.lastAdvancedAt ||
      existingTrace.generatedAt ||
      new Date().toISOString();
    return existingTrace;
  }

  const steps = await generateTraceSteps(normalizedObjective);
  const timestamp = new Date().toISOString();

  values.objectiveTrace = {
    objective: normalizedObjective,
    steps,
    visibleCount: 1,
    generatedAt: timestamp,
    lastAdvancedAt: timestamp,
    status: "active",
    runRootMessageId: currentRunRootMessageId,
  };

  return values.objectiveTrace;
}

export function syncObjectiveTraceProgress(
  values: ConversationStateValues,
  now = new Date(),
): DeepResearchObjectiveTrace | undefined {
  const trace = values.objectiveTrace;
  if (!trace || trace.status !== "active" || !trace.steps?.length) {
    return trace;
  }

  const currentVisibleCount = clampVisibleCount(trace);
  trace.visibleCount = currentVisibleCount;

  const baseTimestamp = Date.parse(
    trace.lastAdvancedAt || trace.generatedAt || now.toISOString(),
  );

  if (!Number.isFinite(baseTimestamp)) {
    trace.lastAdvancedAt = now.toISOString();
    return trace;
  }

  const increments = Math.floor(
    (now.getTime() - baseTimestamp) / OBJECTIVE_TRACE_REVEAL_INTERVAL_MS,
  );

  if (increments <= 0) {
    return trace;
  }

  trace.visibleCount = Math.min(
    trace.steps.length,
    currentVisibleCount + increments,
  );
  trace.lastAdvancedAt = new Date(
    baseTimestamp + increments * OBJECTIVE_TRACE_REVEAL_INTERVAL_MS,
  ).toISOString();

  return trace;
}

export function completeObjectiveTrace(
  values: ConversationStateValues,
): DeepResearchObjectiveTrace | undefined {
  const trace = values.objectiveTrace;
  if (!trace) {
    return trace;
  }

  trace.status = "completed";
  trace.visibleCount = trace.steps.length;
  trace.lastAdvancedAt = new Date().toISOString();
  return trace;
}

export function markObjectiveTraceStale(
  values: ConversationStateValues,
): DeepResearchObjectiveTrace | undefined {
  const trace = values.objectiveTrace;
  if (!trace) {
    return trace;
  }

  trace.status = "stale";
  trace.visibleCount = clampVisibleCount(trace);
  trace.lastAdvancedAt = new Date().toISOString();
  return trace;
}
