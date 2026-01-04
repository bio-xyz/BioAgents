/**
 * DOI extraction and normalization utilities
 */

/**
 * Extract DOI citations from LaTeX content
 * Matches patterns like \cite{doi:10.xxxx/xxxx} or \citep{doi:10.xxxx/xxxx}
 */
export function extractDOICitations(latexContent: string): string[] {
  const citeRegex = /\\cite[pt]?\{([^}]+)\}/g;
  const dois: string[] = [];

  let match;
  while ((match = citeRegex.exec(latexContent)) !== null) {
    const citations = match[1]!.split(",").map((c) => c.trim());

    for (const citation of citations) {
      if (citation.startsWith("doi:")) {
        const doi = citation.substring(4); // Remove "doi:" prefix
        dois.push(normalizeDOI(doi));
      }
    }
  }

  return Array.from(new Set(dois)); // Deduplicate
}

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

/**
 * Extract DOIs from text (find DOI patterns in task outputs)
 */
export function extractDOIsFromText(text: string): string[] {
  const doiRegex = /10\.\d{4,}\/[^\s,;)]+/g;
  const dois: string[] = [];

  let match;
  while ((match = doiRegex.exec(text)) !== null) {
    const doi = normalizeDOI(match[0]);
    if (isValidDOI(doi)) {
      dois.push(doi);
    }
  }

  return Array.from(new Set(dois));
}

/**
 * Check if a DOI exists in a list of allowed DOIs (from task outputs)
 */
export function isDOIAllowed(doi: string, allowedDOIs: string[]): boolean {
  const normalized = normalizeDOI(doi);
  return allowedDOIs.some((allowed) => normalizeDOI(allowed) === normalized);
}
