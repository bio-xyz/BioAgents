import logger from "../../../utils/logger";
import { normalizeDOI, doiToCitekey, isValidDOI } from "./doi";
import { replaceUnicodeInLatex } from "./escapeLatex";
import type { BibTeXEntry } from "../types";

/**
 * Resolve DOI to BibTeX via doi.org or Crossref API fallback
 */
export async function resolveDOIToBibTeX(doi: string): Promise<string | null> {
  const normalizedDOI = normalizeDOI(doi);

  if (!isValidDOI(normalizedDOI)) {
    logger.warn({ doi: normalizedDOI }, "invalid_doi_format");
    return null;
  }

  try {
    const response = await fetch(`https://doi.org/${normalizedDOI}`, {
      headers: { Accept: "application/x-bibtex" },
    });
    if (response.ok) return await response.text();
  } catch (error) {
    logger.warn({ doi: normalizedDOI }, "doi_org_resolution_failed");
  }

  try {
    const response = await fetch(
      `https://api.crossref.org/works/${normalizedDOI}/transform/application/x-bibtex`,
    );
    if (response.ok) return await response.text();
  } catch (error) {
    logger.warn({ doi: normalizedDOI }, "crossref_resolution_failed");
  }

  logger.error({ doi: normalizedDOI }, "doi_resolution_failed");
  return null;
}

export async function resolveMultipleDOIs(
  dois: string[],
): Promise<BibTeXEntry[]> {
  const uniqueDOIs = Array.from(new Set(dois.map(normalizeDOI)));
  logger.info({ count: uniqueDOIs.length }, "resolving_dois_to_bibtex");

  const results = await Promise.all(
    uniqueDOIs.map(async (doi) => {
      const bibtex = await resolveDOIToBibTeX(doi);
      if (!bibtex) return null;

      const result = extractAndSanitizeBibTeXEntry(bibtex);
      if (!result) {
        logger.warn({ doi }, "failed_to_extract_citekey_from_bibtex");
        return null;
      }

      return { doi, citekey: result.citekey, bibtex: result.bibtex };
    }),
  );

  return results.filter((r): r is BibTeXEntry => r !== null);
}

export function sanitizeCitekey(citekey: string): string {
  return citekey
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .replace(/^[^a-zA-Z]/, "X")
    .substring(0, 64);
}

export function extractCitekeyFromBibTeX(bibtex: string): string | null {
  const patterns = [
    /@\w+\s*\{\s*([^,\s}]+)/m,
    /@\w+\s*\{\s*([^,}]+?)\s*,/m,
  ];

  for (const pattern of patterns) {
    const match = bibtex.match(pattern);
    if (match?.[1]) {
      const key = match[1].trim();
      if (key.length > 0) return key;
    }
  }

  logger.warn({ bibtexPreview: bibtex.substring(0, 200) }, "failed_to_extract_citekey");
  return null;
}

export function extractAndSanitizeBibTeXEntry(
  bibtex: string,
): { citekey: string; bibtex: string } | null {
  const originalCitekey = extractCitekeyFromBibTeX(bibtex);
  if (!originalCitekey) return null;

  const sanitizedCitekey = sanitizeCitekey(originalCitekey);

  // Sanitize Unicode characters in BibTeX content (e.g., β → $\beta$)
  // This prevents LaTeX compilation errors from Unicode in titles/abstracts
  let sanitizedBibtex = replaceUnicodeInLatex(bibtex);

  if (sanitizedCitekey !== originalCitekey) {
    sanitizedBibtex = rewriteBibTeXCitekey(sanitizedBibtex, sanitizedCitekey);
    logger.info({ original: originalCitekey, sanitized: sanitizedCitekey }, "sanitized_citekey");
  }

  return { citekey: sanitizedCitekey, bibtex: sanitizedBibtex };
}

export function rewriteBibTeXCitekey(bibtex: string, newCitekey: string): string {
  return bibtex.replace(/^(@\w+\{)[^,]+,/m, `$1${newCitekey},`);
}

export function deduplicateAndResolveCollisions(
  entries: BibTeXEntry[],
): BibTeXEntry[] {
  const doiMap = new Map<string, BibTeXEntry>();
  for (const entry of entries) {
    const normalizedDOI = normalizeDOI(entry.doi);
    if (!doiMap.has(normalizedDOI)) {
      doiMap.set(normalizedDOI, entry);
    }
  }

  const dedupedEntries = Array.from(doiMap.values());
  const citekeyUsage = new Map<string, number>();
  const finalEntries: BibTeXEntry[] = [];

  for (const entry of dedupedEntries) {
    let finalCitekey = entry.citekey;
    const usageCount = citekeyUsage.get(finalCitekey) || 0;

    if (usageCount > 0) {
      finalCitekey = `${entry.citekey}_${usageCount + 1}`;
      const updatedBibtex = rewriteBibTeXCitekey(entry.bibtex, finalCitekey);
      logger.info({ original: entry.citekey, disambiguated: finalCitekey }, "citekey_collision");
      finalEntries.push({ doi: entry.doi, citekey: finalCitekey, bibtex: updatedBibtex });
    } else {
      finalEntries.push(entry);
    }

    citekeyUsage.set(entry.citekey, usageCount + 1);
  }

  logger.info({ total: finalEntries.length }, "deduplicated_bibtex");
  return finalEntries;
}

export function generateBibTeXFile(entries: BibTeXEntry[]): string {
  const header = `% BibTeX references for Deep Research paper\n\n`;
  const bibContent = entries
    .map((entry) => `% DOI: ${entry.doi}\n${entry.bibtex}\n`)
    .join("\n");
  return header + bibContent;
}

function extractDOIFromCitation(citation: string): string | null {
  if (citation.startsWith("doi:")) {
    return normalizeDOI(citation.substring(4));
  }

  if (citation.startsWith("doi_")) {
    const doiPart = citation.substring(4);
    const reconstructed = doiPart.replace(/_/g, "/").replace(/^(\d+)\//, "$1.");
    const fixed = reconstructed.replace(/^(10)\/(\d{4,})\//, "$1.$2/");
    return normalizeDOI(fixed);
  }

  if (citation.match(/^10\.\d{4,}\//)) {
    return normalizeDOI(citation);
  }

  return null;
}

/**
 * Rewrite LaTeX citations from DOI formats to author-year citekeys
 */
export function rewriteLatexCitations(
  latexContent: string,
  doiToCitekeyMap: Map<string, string>,
): string {
  let totalRewrites = 0;
  let failedRewrites = 0;
  const citeRegex = /(\\cite[pt]?\{)([^}]+)(\})/g;

  const rewritten = latexContent.replace(citeRegex, (_match, prefix, citations, suffix) => {
    const citationList = citations.split(",").map((c: string) => c.trim());

    const rewrittenCitations = citationList.map((citation: string) => {
      const doi = extractDOIFromCitation(citation);

      if (doi) {
        const citekey = doiToCitekeyMap.get(doi);
        if (citekey) {
          totalRewrites++;
          return citekey;
        } else {
          failedRewrites++;
          logger.warn({ citation, doi }, "citation_missing_mapping");
          return citation;
        }
      }

      return citation;
    });

    return prefix + rewrittenCitations.join(",") + suffix;
  });

  logger.info({ totalRewrites, failedRewrites }, "citations_rewritten");
  return rewritten;
}

export function extractCitekeys(latexContent: string): string[] {
  const citeRegex = /\\cite[pt]?\{([^}]+)\}/g;
  const citekeys: string[] = [];

  let match;
  while ((match = citeRegex.exec(latexContent)) !== null) {
    if (match[1]) {
      const citations = match[1].split(",").map((c) => c.trim());
      citekeys.push(...citations);
    }
  }

  return Array.from(new Set(citekeys));
}

export function citekeyExistsInBibTeX(
  citekey: string,
  entries: BibTeXEntry[],
): boolean {
  return entries.some((entry) => entry.citekey === citekey);
}
