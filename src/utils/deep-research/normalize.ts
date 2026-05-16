export function normalizeDeepResearchObjective(objective?: string): string | undefined {
  const trimmed = objective?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : undefined;
}
