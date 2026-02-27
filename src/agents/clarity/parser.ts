/**
 * Extracts protein name and variant notation from natural language objectives.
 *
 * Handles patterns like:
 * - "SOD1 A4V" → { protein: "SOD1", variant: "A4V" }
 * - "alpha-synuclein A53T" → { protein: "alpha-synuclein", variant: "A53T" }
 * - "Query fold data for tau P301L" → { protein: "tau", variant: "P301L" }
 * - "What is the structural impact of APOE C112R?" → { protein: "APOE", variant: "C112R" }
 */

export type ParsedVariant = {
  protein: string;
  variant: string;
};

// Standard single-residue substitution: letter, digits, letter (e.g. A4V, G2019S, C112R)
const VARIANT_PATTERN = /[A-Z]\d+[A-Z]/;

// Protein name: word characters plus hyphens (e.g. alpha-synuclein, TDP-43, SOD1)
const PROTEIN_VARIANT_PATTERN =
  /\b([\w][\w-]*)\s+([A-Z]\d+[A-Z])\b/;

export function parseVariantFromObjective(
  objective: string,
): ParsedVariant | null {
  // Try the combined protein + variant pattern first
  const match = objective.match(PROTEIN_VARIANT_PATTERN);
  if (match && match[1] && match[2]) {
    const candidate = match[1];
    // Skip common English words that might precede a variant-like pattern
    const skipWords = new Set([
      "the",
      "for",
      "and",
      "with",
      "from",
      "about",
      "into",
      "like",
      "over",
      "position",
      "residue",
      "mutation",
      "variant",
      "substitution",
    ]);
    if (!skipWords.has(candidate.toLowerCase())) {
      return { protein: candidate, variant: match[2] };
    }
  }

  // Fallback: find any variant pattern and take the preceding word as protein
  const variantMatch = objective.match(VARIANT_PATTERN);
  if (variantMatch) {
    const idx = objective.indexOf(variantMatch[0]);
    const before = objective.slice(0, idx).trim();
    const words = before.split(/\s+/);
    const lastWord = words[words.length - 1];
    if (lastWord && lastWord.length >= 2) {
      return { protein: lastWord, variant: variantMatch[0] };
    }
  }

  return null;
}
