import logger from "../../../utils/logger";
import type { BibTeXEntry } from "../types";
import { isValidDOI, normalizeDOI } from "./doi";

// Configuration for DOI resolution
const DOI_FETCH_TIMEOUT_MS = 10000; // 10 seconds per request
const DOI_RETRY_ATTEMPTS = 3;
const DOI_RETRY_BASE_DELAY_MS = 500; // Base delay for exponential backoff
const DOI_BATCH_SIZE = 10; // Process DOIs in batches
const DOI_BATCH_DELAY_MS = 200; // Delay between batches to avoid rate limiting
const DOI_USER_AGENT = "BioAgents-Paper-Generator/1.0 (https://bio.xyz)";

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve DOI to BibTeX via doi.org or Crossref API fallback
 * Includes timeout, retries with exponential backoff, and proper error logging
 */
export async function resolveDOIToBibTeX(doi: string): Promise<string | null> {
  const normalizedDOI = normalizeDOI(doi);

  if (!isValidDOI(normalizedDOI)) {
    logger.warn({ doi: normalizedDOI }, "invalid_doi_format");
    return null;
  }

  // Try doi.org first with retries
  for (let attempt = 1; attempt <= DOI_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `https://doi.org/${normalizedDOI}`,
        {
          headers: {
            Accept: "application/x-bibtex",
            "User-Agent": DOI_USER_AGENT,
          },
        },
        DOI_FETCH_TIMEOUT_MS,
      );

      if (response.ok) {
        return await response.text();
      }

      // Log non-OK responses with status code
      if (response.status === 429) {
        logger.warn(
          { doi: normalizedDOI, status: response.status, attempt },
          "doi_org_rate_limited",
        );
        // Wait longer on rate limit
        await sleep(DOI_RETRY_BASE_DELAY_MS * attempt * 2);
        continue;
      }

      if (response.status >= 500) {
        logger.warn(
          { doi: normalizedDOI, status: response.status, attempt },
          "doi_org_server_error",
        );
        await sleep(DOI_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }

      // 404 or other client errors - don't retry, try fallback
      logger.warn(
        { doi: normalizedDOI, status: response.status },
        "doi_org_client_error",
      );
      break;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isTimeout =
        errorMessage.includes("abort") || errorMessage.includes("timeout");

      logger.warn(
        { doi: normalizedDOI, attempt, error: errorMessage, isTimeout },
        "doi_org_resolution_failed",
      );

      if (attempt < DOI_RETRY_ATTEMPTS) {
        await sleep(DOI_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  // Try Crossref API as fallback with retries
  for (let attempt = 1; attempt <= DOI_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `https://api.crossref.org/works/${normalizedDOI}/transform/application/x-bibtex`,
        {
          headers: {
            "User-Agent": DOI_USER_AGENT,
          },
        },
        DOI_FETCH_TIMEOUT_MS,
      );

      if (response.ok) {
        return await response.text();
      }

      if (response.status === 429) {
        logger.warn(
          { doi: normalizedDOI, status: response.status, attempt },
          "crossref_rate_limited",
        );
        await sleep(DOI_RETRY_BASE_DELAY_MS * attempt * 2);
        continue;
      }

      if (response.status >= 500) {
        logger.warn(
          { doi: normalizedDOI, status: response.status, attempt },
          "crossref_server_error",
        );
        await sleep(DOI_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }

      // 404 or other client errors - don't retry
      logger.warn(
        { doi: normalizedDOI, status: response.status },
        "crossref_client_error",
      );
      break;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.warn(
        { doi: normalizedDOI, attempt, error: errorMessage },
        "crossref_resolution_failed",
      );

      if (attempt < DOI_RETRY_ATTEMPTS) {
        await sleep(DOI_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  logger.error({ doi: normalizedDOI }, "doi_resolution_failed");
  return null;
}

/**
 * Resolve multiple DOIs to BibTeX entries
 * Uses batched sequential processing to avoid rate limiting
 */
export async function resolveMultipleDOIs(
  dois: string[],
): Promise<BibTeXEntry[]> {
  const uniqueDOIs = Array.from(new Set(dois.map(normalizeDOI)));
  logger.info({ count: uniqueDOIs.length }, "resolving_dois_to_bibtex");

  const results: BibTeXEntry[] = [];
  let resolvedCount = 0;
  let failedCount = 0;

  // Process in batches to avoid rate limiting
  for (let i = 0; i < uniqueDOIs.length; i += DOI_BATCH_SIZE) {
    const batch = uniqueDOIs.slice(i, i + DOI_BATCH_SIZE);
    const batchNumber = Math.floor(i / DOI_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueDOIs.length / DOI_BATCH_SIZE);

    logger.info(
      { batchNumber, totalBatches, batchSize: batch.length },
      "processing_doi_batch",
    );

    // Process batch sequentially (not in parallel) to be gentle on APIs
    for (const doi of batch) {
      const bibtex = await resolveDOIToBibTeX(doi);

      if (!bibtex) {
        failedCount++;
        continue;
      }

      const extracted = extractAndSanitizeBibTeXEntry(bibtex);
      if (!extracted) {
        logger.warn({ doi }, "failed_to_extract_citekey_from_bibtex");
        failedCount++;
        continue;
      }

      results.push({
        doi,
        citekey: extracted.citekey,
        bibtex: extracted.bibtex,
      });
      resolvedCount++;
    }

    // Add delay between batches to avoid rate limiting
    if (i + DOI_BATCH_SIZE < uniqueDOIs.length) {
      await sleep(DOI_BATCH_DELAY_MS);
    }
  }

  logger.info(
    { resolved: resolvedCount, failed: failedCount, total: uniqueDOIs.length },
    "doi_resolution_complete",
  );

  return results;
}

export function sanitizeCitekey(citekey: string): string {
  return citekey
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .replace(/^[^a-zA-Z]/, "X")
    .substring(0, 64);
}

export function extractCitekeyFromBibTeX(bibtex: string): string | null {
  const patterns = [/@\w+\s*\{\s*([^,\s}]+)/m, /@\w+\s*\{\s*([^,}]+?)\s*,/m];

  for (const pattern of patterns) {
    const match = bibtex.match(pattern);
    if (match?.[1]) {
      const key = match[1].trim();
      if (key.length > 0) return key;
    }
  }

  logger.warn(
    { bibtexPreview: bibtex.substring(0, 200) },
    "failed_to_extract_citekey",
  );
  return null;
}

export function extractAndSanitizeBibTeXEntry(
  bibtex: string,
): { citekey: string; bibtex: string } | null {
  const originalCitekey = extractCitekeyFromBibTeX(bibtex);
  if (!originalCitekey) return null;

  const sanitizedCitekey = sanitizeCitekey(originalCitekey);

  // Decode HTML entities (DOI resolvers sometimes return HTML-encoded content)
  // With XeLaTeX, Unicode is handled natively - no conversion needed
  let sanitizedBibtex = decodeHtmlEntitiesForLatex(bibtex);

  if (sanitizedCitekey !== originalCitekey) {
    sanitizedBibtex = rewriteBibTeXCitekey(sanitizedBibtex, sanitizedCitekey);
    logger.info(
      { original: originalCitekey, sanitized: sanitizedCitekey },
      "sanitized_citekey",
    );
  }

  return { citekey: sanitizedCitekey, bibtex: sanitizedBibtex };
}

/**
 * Decode HTML entities in BibTeX content
 * DOI resolvers (Crossref, doi.org) sometimes return HTML-encoded content
 *
 * With XeLaTeX: Converts HTML entities to actual Unicode characters (which XeLaTeX handles natively)
 * Exception: & must still be escaped as \& (LaTeX special char)
 */
export function decodeHtmlEntitiesForLatex(text: string): string {
  return (
    text
      // Ampersand - must be escaped in LaTeX (special char)
      .replace(/&amp;/g, "\\&")
      // Standard HTML entities → actual characters (XeLaTeX handles Unicode)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ") // Non-breaking space → regular space (XeLaTeX handles it)
      .replace(/&ndash;/g, "–") // En dash
      .replace(/&mdash;/g, "—") // Em dash
      .replace(/&lsquo;/g, "'") // Left single quote
      .replace(/&rsquo;/g, "'") // Right single quote
      .replace(/&ldquo;/g, '"') // Left double quote
      .replace(/&rdquo;/g, '"') // Right double quote
      // Numeric HTML entities → actual characters
      .replace(/&#(\d+);/g, (_, code) => {
        const num = parseInt(code, 10);
        if (num === 38) return "\\&"; // & must be escaped
        return String.fromCharCode(num);
      })
  );
}

export function rewriteBibTeXCitekey(
  bibtex: string,
  newCitekey: string,
): string {
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
      logger.info(
        { original: entry.citekey, disambiguated: finalCitekey },
        "citekey_collision",
      );
      finalEntries.push({
        doi: entry.doi,
        citekey: finalCitekey,
        bibtex: updatedBibtex,
      });
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

  const rewritten = latexContent.replace(
    citeRegex,
    (_match, prefix, citations, suffix) => {
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
    },
  );

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
