import type { PlanTask } from "../types/core";
import type { SourceSelectionId } from "../types/sourceSelection";

const AMINO_ACID_ALPHABET = "ACDEFGHIKLMNPQRSTVWYBXZJUO";
const MIN_EXPLICIT_PROTEIN_SEQUENCE_LENGTH = 20;

type SourceSelectionRoutingRule = {
  sources: string[];
  requiresExplicitProteinSequence?: boolean;
};

const SOURCE_SELECTION_ROUTING_RULES: Partial<
  Record<SourceSelectionId, SourceSelectionRoutingRule>
> = {
  alphafold_db: {
    requiresExplicitProteinSequence: true,
    sources: ["alphafold_db"],
  },
};

function normalizeSequenceCandidate(candidate: string): string {
  return candidate.toUpperCase().replace(/[^A-Z]/g, "");
}

function isExplicitProteinSequence(candidate: string): boolean {
  return (
    candidate.length >= MIN_EXPLICIT_PROTEIN_SEQUENCE_LENGTH &&
    new RegExp(`^[${AMINO_ACID_ALPHABET}]+$`).test(candidate)
  );
}

function findSequenceInBackticks(message: string): string | undefined {
  const matches = message.matchAll(/`([^`\n]+)`/g);

  for (const match of matches) {
    const candidate = normalizeSequenceCandidate(match[1] || "");
    if (isExplicitProteinSequence(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function findSequenceInFasta(message: string): string | undefined {
  const fastaMatches = message.matchAll(
    /(?:^|\n)>\s*[^\n]*\n(([A-Za-z*-]+\s*){20,})/gm
  );

  for (const match of fastaMatches) {
    const candidate = normalizeSequenceCandidate(match[1] || "");
    if (isExplicitProteinSequence(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function findLabeledSequence(message: string): string | undefined {
  const sequenceBody = `[${AMINO_ACID_ALPHABET}${AMINO_ACID_ALPHABET.toLowerCase()}\\s-]{${MIN_EXPLICIT_PROTEIN_SEQUENCE_LENGTH},}`;
  const patterns = [
    new RegExp(
      `\\b(?:protein|amino acid|aa|peptide)\\s+sequence\\b\\s*[:=]?\\s*(${sequenceBody})`,
      "i"
    ),
    new RegExp(`\\bsequence\\b\\s*[:=]\\s*(${sequenceBody})`, "i"),
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const candidate = normalizeSequenceCandidate(match[1]);
    if (isExplicitProteinSequence(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function getSourceSelectionRoutingRule(
  sourceSelectionId?: SourceSelectionId
): SourceSelectionRoutingRule | undefined {
  if (!sourceSelectionId) {
    return undefined;
  }

  const rule = SOURCE_SELECTION_ROUTING_RULES[sourceSelectionId];
  return rule ? { ...rule, sources: [...rule.sources] } : undefined;
}

export function extractExplicitProteinSequence(message: string): string | undefined {
  if (!message) {
    return undefined;
  }

  return (
    findSequenceInFasta(message) ||
    findSequenceInBackticks(message) ||
    findLabeledSequence(message)
  );
}

export function getPlanningSourceSelectionGuidance(
  sourceSelectionId: SourceSelectionId | undefined,
  userMessage: string
): string {
  if (!sourceSelectionId) {
    return "No source selection override is active.";
  }

  const rule = getSourceSelectionRoutingRule(sourceSelectionId);
  if (!rule) {
    return `sourceSelectionId=${sourceSelectionId}. No runtime source override is defined for this selection in this build. Plan normally and do not add task.sources unless the user explicitly requires it.`;
  }

  const explicitProteinSequence = rule.requiresExplicitProteinSequence
    ? extractExplicitProteinSequence(userMessage)
    : undefined;

  if (rule.requiresExplicitProteinSequence && explicitProteinSequence) {
    return `sourceSelectionId=${sourceSelectionId}. The user supplied an explicit protein sequence. Create exactly one LITERATURE task whose objective is exactly "${explicitProteinSequence}" and include "sources": ${JSON.stringify(rule.sources)} on that task. Do not add extra wording to the objective.`;
  }

  if (rule.requiresExplicitProteinSequence) {
    return `sourceSelectionId=${sourceSelectionId}. Only use a task-level "sources" override if the user message contains an explicit protein sequence. If no explicit protein sequence is present, do not force source-specific routing or rewrite the task objective to a sequence-only query.`;
  }

  return `sourceSelectionId=${sourceSelectionId}. If you need a source-specific literature task for this request, include "sources": ${JSON.stringify(rule.sources)} on the relevant LITERATURE task.`;
}

export function getChatAgentSourceSelectionGuidance(
  sourceSelectionId: SourceSelectionId | undefined,
  userMessage: string
): string | undefined {
  if (!sourceSelectionId) {
    return undefined;
  }

  const rule = getSourceSelectionRoutingRule(sourceSelectionId);
  if (!rule) {
    return `- A source selection hint is active (${sourceSelectionId}), but there is no special runtime routing for it in this build.`;
  }

  const explicitProteinSequence = rule.requiresExplicitProteinSequence
    ? extractExplicitProteinSequence(userMessage)
    : undefined;

  if (rule.requiresExplicitProteinSequence && explicitProteinSequence) {
    return `- The user selected ${sourceSelectionId} and supplied an explicit protein sequence.
- If you use literature_search, prefer source="biolit".
- Treat the protein sequence itself as the primary search query and do not expand it with extra wording.`;
  }

  if (rule.requiresExplicitProteinSequence) {
    return `- The user selected ${sourceSelectionId}, but this only changes routing when the current user message contains an explicit protein sequence.
- If no explicit protein sequence is present, ignore the source-selection hint and answer normally.`;
  }

  return `- The user selected ${sourceSelectionId}. If you use literature_search for this request, prefer the source-specific route that can honor that selection.`;
}

export function resolveSourceSelectionLiteratureOverride(input: {
  objective: string;
  sourceSelectionId?: SourceSelectionId;
  userMessage: string;
}): { objective: string; sources?: string[] } {
  const { objective, sourceSelectionId, userMessage } = input;
  const rule = getSourceSelectionRoutingRule(sourceSelectionId);

  if (!rule) {
    return { objective };
  }

  if (rule.requiresExplicitProteinSequence) {
    const explicitProteinSequence = extractExplicitProteinSequence(userMessage);
    if (!explicitProteinSequence) {
      return { objective };
    }

    return {
      objective: explicitProteinSequence,
      sources: [...rule.sources],
    };
  }

  return {
    objective,
    sources: [...rule.sources],
  };
}

export function applySourceSelectionPlanningOverrides(input: {
  plan: PlanTask[];
  sourceSelectionId?: SourceSelectionId;
  userMessage: string;
}): PlanTask[] {
  const { plan, sourceSelectionId, userMessage } = input;
  const rule = getSourceSelectionRoutingRule(sourceSelectionId);

  if (!rule?.requiresExplicitProteinSequence) {
    return plan;
  }

  const explicitProteinSequence = extractExplicitProteinSequence(userMessage);
  if (!explicitProteinSequence) {
    return plan;
  }

  const firstLiteratureTask = plan.find((task) => task.type === "LITERATURE");
  const nonLiteratureTasks = plan.filter((task) => task.type !== "LITERATURE");

  const literatureTask: PlanTask = {
    ...(firstLiteratureTask || {
      datasets: [],
      type: "LITERATURE" as const,
    }),
    datasets: [],
    objective: explicitProteinSequence,
    sources: [...rule.sources],
    type: "LITERATURE",
  };

  return [literatureTask, ...nonLiteratureTasks];
}
