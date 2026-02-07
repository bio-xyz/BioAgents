/**
 * DOI extraction and normalization utilities
 */

/**
 * Normalize DOI (lowercase, strip trailing punctuation, unescape LaTeX)
 */
export function normalizeDOI(doi: string): string {
  return doi
    .toLowerCase()
    .trim()
    .replace(/\\_/g, "_") // Unescape LaTeX-escaped underscores
    .replace(/\\&/g, "&") // Unescape LaTeX-escaped ampersands
    .replace(/\\%/g, "%") // Unescape LaTeX-escaped percent signs
    .replace(/[.,;:]+$/, ""); // Remove trailing punctuation
}

/**
 * Create a stable citekey from a DOI
 * Format: doi_10_1234_nature_12345
 */
export function doiToCitekey(doi: string): string {
  const normalized = normalizeDOI(doi);
  return "doi_" + normalized.replace(/[^a-z0-9]/g, "_");
}

/**
 * Validate DOI format (basic check)
 */
export function isValidDOI(doi: string): boolean {
  // DOI format: 10.xxxx/xxxxx
  return /^10\.\d{4,}\/[^\s]+$/.test(doi);
}
