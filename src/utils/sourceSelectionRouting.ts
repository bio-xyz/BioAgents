import type { PlanTask } from "../types/core";
import type { SourceSelectionId } from "../types/sourceSelection";

const AMINO_ACID_ALPHABET = "ACDEFGHIKLMNPQRSTVWY";
const MIN_EXPLICIT_PROTEIN_SEQUENCE_LENGTH = 20;

type SourceSelectionRoutingRule = {
  sources: SourceSelectionId[];
  requiresExplicitProteinSequence?: boolean;
};

const SOURCE_SELECTION_ROUTING_RULES: Partial<
  Record<SourceSelectionId, SourceSelectionRoutingRule>
> = {
  alphafold_db: {
    requiresExplicitProteinSequence: true,
    sources: ["alphafold_db"],
  },
  chembl: {
    sources: ["chembl"],
  },
  "clinical-trials": {
    sources: ["clinical-trials"],
  },
  enrichr: {
    sources: ["enrichr"],
  },
  ensembl: {
    sources: ["ensembl"],
  },
  open_targets: {
    sources: ["open_targets"],
  },
  pdb: {
    sources: ["pdb"],
  },
  pubmed: {
    sources: ["pubmed"],
  },
  uniprot: {
    sources: ["uniprot"],
  },
};

function normalizeSequenceCandidate(candidate: string): string | undefined {
  if (!/^[A-Za-z\s-]+$/.test(candidate)) {
    return undefined;
  }

  return candidate.toUpperCase().replace(/[\s-]/g, "");
}

function isExplicitProteinSequence(candidate: string): boolean {
  return (
    candidate.length >= MIN_EXPLICIT_PROTEIN_SEQUENCE_LENGTH &&
    new RegExp(`^[${AMINO_ACID_ALPHABET}]+$`).test(candidate)
  );
}

function findSequenceInBackticks(message: string): string | undefined {
  const matches = message.matchAll(/`([^`]+)`/g);

  for (const match of matches) {
    const candidate = normalizeSequenceCandidate(match[1] || "");
    if (candidate && isExplicitProteinSequence(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function findSequenceInFasta(message: string): string | undefined {
  const lines = message.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]?.trimStart().startsWith(">")) {
      continue;
    }

    const sequenceLines: string[] = [];
    for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] || "";
      if (line.trimStart().startsWith(">") || line.trim() === "") {
        break;
      }
      sequenceLines.push(line.trim());
    }

    if (sequenceLines.length === 0 || sequenceLines.some((line) => !/^[A-Za-z-]+$/.test(line))) {
      continue;
    }

    const candidate = normalizeSequenceCandidate(sequenceLines.join(""));
    if (candidate && isExplicitProteinSequence(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function findLabeledSequence(message: string): string | undefined {
  const labelPattern = /\b(?:(?:protein|amino acid|aa|peptide)\s+sequence|(sequence))\b\s*[:=]/gi;

  for (const match of message.matchAll(labelPattern)) {
    const afterLabel = message.slice((match.index || 0) + match[0].length);
    const block = afterLabel.split(/\n\s*\n/)[0] || "";
    const lines = block.split(/\r?\n/);
    const sameLineCandidate = lines[0]?.trim() || "";
    const sequenceText =
      sameLineCandidate.length > 0
        ? sameLineCandidate
        : lines
            .slice(1)
            .map((line) => line.trim())
            .filter(Boolean)
            .join("");

    if (!sequenceText || !/^[A-Za-z-]+$/.test(sequenceText)) {
      continue;
    }

    const candidate = normalizeSequenceCandidate(sequenceText);
    if (match[1] && candidate && /^[ACGT]+$/.test(candidate)) {
      continue;
    }
    if (candidate && isExplicitProteinSequence(candidate)) {
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
    findSequenceInFasta(message) || findSequenceInBackticks(message) || findLabeledSequence(message)
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

  return `sourceSelectionId=${sourceSelectionId}. This selected source is deterministic. Include "sources": ${JSON.stringify(rule.sources)} on each relevant LITERATURE task.`;
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
- Call literature_search with source="biolit".
- Treat the protein sequence itself as the primary search query and do not expand it with extra wording.`;
  }

  if (rule.requiresExplicitProteinSequence) {
    return `- The user selected ${sourceSelectionId}, but this only changes routing when the current user message contains an explicit protein sequence.
- If no explicit protein sequence is present, ignore the source-selection hint and answer normally.`;
  }

  return `- The user selected ${sourceSelectionId}. Call literature_search with source="biolit"; the runtime will force sources=${JSON.stringify(rule.sources)}.`;
}

export function resolveSourceSelectionLiteratureOverride(input: {
  objective: string;
  sourceSelectionId?: SourceSelectionId;
  userMessage: string;
}): { objective: string; sources?: SourceSelectionId[] } {
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

  if (!rule) {
    return plan;
  }

  if (rule.requiresExplicitProteinSequence) {
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

  return plan.map((task) =>
    task.type === "LITERATURE"
      ? {
          ...task,
          sources: [...rule.sources],
        }
      : task
  );
}

export function applySourceSelectionToPromotedTasks(input: {
  tasks: PlanTask[];
  sourceSelectionId?: SourceSelectionId;
  userMessage: string;
}): PlanTask[] {
  return applySourceSelectionPlanningOverrides({
    plan: input.tasks,
    sourceSelectionId: input.sourceSelectionId,
    userMessage: input.userMessage,
  });
}
