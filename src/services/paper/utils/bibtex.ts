/**
 * BibTeX resolution and manipulation utilities
 */

import logger from "../../../utils/logger";
import { normalizeDOI, doiToCitekey, isValidDOI } from "./doi";
import type { BibTeXEntry } from "../types";

/**
 * Resolve a DOI to BibTeX entry
 * Tries doi.org first, then Crossref API as fallback
 */
export async function resolveDOIToBibTeX(doi: string): Promise<string | null> {
  const normalizedDOI = normalizeDOI(doi);

  if (!isValidDOI(normalizedDOI)) {
    logger.warn({ doi: normalizedDOI }, "invalid_doi_format");
    return null;
  }

  // Try doi.org first
  try {
    const response = await fetch(`https://doi.org/${normalizedDOI}`, {
      headers: {
        Accept: "application/x-bibtex",
      },
    });

    if (response.ok) {
      const bibtex = await response.text();
      logger.info({ doi: normalizedDOI }, "doi_resolved_via_doi_org");
      return bibtex;
    }
  } catch (error) {
    logger.warn({ doi: normalizedDOI, error }, "doi_org_resolution_failed");
  }

  // Fallback to Crossref API
  try {
    const response = await fetch(
      `https://api.crossref.org/works/${normalizedDOI}/transform/application/x-bibtex`,
    );

    if (response.ok) {
      const bibtex = await response.text();
      logger.info({ doi: normalizedDOI }, "doi_resolved_via_crossref");
      return bibtex;
    }
  } catch (error) {
    logger.warn({ doi: normalizedDOI, error }, "crossref_resolution_failed");
  }

  logger.error({ doi: normalizedDOI }, "doi_resolution_failed");
  return null;
}

/**
 * Resolve multiple DOIs to BibTeX entries in parallel
 */
export async function resolveMultipleDOIs(
  dois: string[],
): Promise<BibTeXEntry[]> {
  const uniqueDOIs = Array.from(new Set(dois.map(normalizeDOI)));

  logger.info({ count: uniqueDOIs.length }, "resolving_dois_to_bibtex");

  const results = await Promise.all(
    uniqueDOIs.map(async (doi) => {
      const bibtex = await resolveDOIToBibTeX(doi);
      if (!bibtex) return null;

      const citekey = doiToCitekey(doi);
      return { doi, citekey, bibtex };
    }),
  );

  return results.filter((r): r is BibTeXEntry => r !== null);
}

/**
 * Rewrite BibTeX entry to use our custom citekey
 * Example: @article{original_key, => @article{doi_10_1234_nature,
 */
export function rewriteBibTeXCitekey(
  bibtex: string,
  newCitekey: string,
): string {
  // Match @type{oldkey, and replace with @type{newkey,
  return bibtex.replace(/^(@\w+\{)[^,]+,/m, `$1${newCitekey},`);
}

/**
 * Generate complete BibTeX file content from entries
 */
export function generateBibTeXFile(entries: BibTeXEntry[]): string {
  const header = `% BibTeX references for Deep Research paper
% Auto-generated from DOI resolution

`;

  const bibContent = entries
    .map((entry) => {
      const rewrittenBib = rewriteBibTeXCitekey(entry.bibtex, entry.citekey);
      return `% DOI: ${entry.doi}\n${rewrittenBib}\n`;
    })
    .join("\n");

  return header + bibContent;
}

/**
 * Rewrite LaTeX citations from doi: placeholders to citekeys
 * Example: \cite{doi:10.1234/nature} => \cite{doi_10_1234_nature}
 */
export function rewriteLatexCitations(
  latexContent: string,
  doiToCitekeyMap: Map<string, string>,
): string {
  let rewritten = latexContent;

  // Match \cite{doi:...}, \citep{doi:...}, \citet{doi:...}
  const citeRegex = /(\\cite[pt]?\{)([^}]+)(\})/g;

  rewritten = rewritten.replace(citeRegex, (match, prefix, citations, suffix) => {
    const citationList = citations.split(",").map((c: string) => c.trim());

    const rewrittenCitations = citationList.map((citation: string) => {
      if (citation.startsWith("doi:")) {
        const doi = normalizeDOI(citation.substring(4));
        const citekey = doiToCitekeyMap.get(doi);
        return citekey || citation; // Keep original if not found
      }
      return citation;
    });

    return prefix + rewrittenCitations.join(",") + suffix;
  });

  return rewritten;
}

/**
 * Extract all citekeys used in LaTeX content
 */
export function extractCitekeys(latexContent: string): string[] {
  const citeRegex = /\\cite[pt]?\{([^}]+)\}/g;
  const citekeys: string[] = [];

  let match;
  while ((match = citeRegex.exec(latexContent)) !== null) {
    const citations = match[1].split(",").map((c) => c.trim());
    citekeys.push(...citations);
  }

  return Array.from(new Set(citekeys));
}

/**
 * Check if a citekey exists in BibTeX entries
 */
export function citekeyExistsInBibTeX(
  citekey: string,
  entries: BibTeXEntry[],
): boolean {
  return entries.some((entry) => entry.citekey === citekey);
}
