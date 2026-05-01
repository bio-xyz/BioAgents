import type { ProteinStructure } from "../types/core";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function structureKey(structure: ProteinStructure): string {
  return (
    structure.entryId ||
    structure.bcifUrl ||
    structure.cifUrl ||
    structure.pdbUrl ||
    structure.entryUrl ||
    ""
  );
}

function normalizeProteinStructure(result: JsonRecord): ProteinStructure | undefined {
  const metadata = asRecord(result.metadata) || {};
  const entryId = asString(metadata.entryId) || asString(result.id);
  if (!entryId) return undefined;

  const structure: ProteinStructure = {
    averagePlddt: asNumber(metadata.averagePlddt),
    bcifUrl: asString(metadata.bcifUrl),
    cifUrl: asString(metadata.cifUrl),
    entryId,
    entryUrl: asString(metadata.entryUrl) || asString(result.url),
    gene: asString(metadata.gene),
    organismScientificName: asString(metadata.organismScientificName),
    paeDocUrl: asString(metadata.paeDocUrl),
    paeImageUrl: asString(metadata.paeImageUrl),
    pdbUrl: asString(metadata.pdbUrl),
    plddtDocUrl: asString(metadata.plddtDocUrl),
    title: asString(result.title),
    uniprotAccession: asString(metadata.uniprotAccession),
    uniprotDescription: asString(metadata.uniprotDescription),
    uniprotId: asString(metadata.uniprotId),
  };

  if (!structure.bcifUrl && !structure.cifUrl && !structure.pdbUrl) {
    return undefined;
  }

  return structure;
}

function toolResultCandidates(response: JsonRecord): JsonRecord[] {
  const candidates: JsonRecord[] = [];
  const direct = asRecord(response.tool_results);
  const nested = asRecord(asRecord(response.response)?.tool_results);
  const outputResponse = asRecord(asRecord(response.output)?.response);
  const outputNested = asRecord(outputResponse?.tool_results);

  for (const toolResults of [direct, nested, outputNested]) {
    if (toolResults) candidates.push(toolResults);
  }

  return candidates;
}

export function mergeProteinStructures(
  ...groups: Array<ProteinStructure[] | undefined>
): ProteinStructure[] {
  const merged: ProteinStructure[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const structure of group || []) {
      const key = structureKey(structure);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(structure);
    }
  }

  return merged;
}

export function extractProteinStructuresFromBioLiteratureResponse(
  value: unknown
): ProteinStructure[] {
  const response = asRecord(value);
  if (!response) return [];

  const structures: ProteinStructure[] = [];
  for (const toolResults of toolResultCandidates(response)) {
    for (const [toolName, rawToolResult] of Object.entries(toolResults)) {
      const toolResult = asRecord(rawToolResult);
      if (!toolResult) continue;
      const rawResults = toolResult.results;
      if (!Array.isArray(rawResults)) continue;

      for (const rawResult of rawResults) {
        const result = asRecord(rawResult);
        if (!result) continue;
        const isAlphaFoldTool = toolName === "search_alphafold";
        const isAlphaFoldResult = asString(result.source) === "alphafold_db";
        if (!isAlphaFoldTool && !isAlphaFoldResult) continue;

        const structure = normalizeProteinStructure(result);
        if (structure) structures.push(structure);
      }
    }
  }

  return mergeProteinStructures(structures);
}
