/**
 * Unified reference extraction — scans text for all references (DOIs and URLs)
 *
 * Extracts DOIs, PMC links, PMID links, ClinicalTrials.gov, ArXiv, and generic URLs
 * from task outputs, returning typed references for BibTeX generation.
 */

import { doiToCitekey, normalizeDOI, isValidDOI } from "../utils/doi";
import { sanitizeCitekey } from "../utils/bibtex";

export type RefType = "doi" | "pmc" | "pmid" | "nct" | "arxiv" | "biorxiv" | "uniprot" | "pubchem" | "url";

export type ExtractedRef = {
  type: RefType;
  url: string; // full URL (for DOIs: https://doi.org/10.xxx)
  id: string; // DOI string, PMC ID, NCT ID, etc.
  title: string; // parsed from surrounding text, or fallback
};

/**
 * Extract all references (DOIs and URLs) from text in a single pass.
 */
export function extractReferences(text: string): ExtractedRef[] {
  const refs: ExtractedRef[] = [];
  const seenIds = new Set<string>();

  // Split into lines for context-based title extraction
  const lines = text.split("\n");

  for (const line of lines) {
    // Find all URLs in this line
    const urlMatches = line.matchAll(/https?:\/\/[^\s,;)>\]]+/g);
    for (const urlMatch of urlMatches) {
      const rawUrl = cleanTrailingPunctuation(urlMatch[0]);
      const ref = classifyUrl(rawUrl, line);
      if (ref && !seenIds.has(ref.id)) {
        seenIds.add(ref.id);
        refs.push(ref);
      }
    }

    // Find bare DOIs (not inside URLs) — e.g. "10.1234/something"
    const bareDOIMatches = line.matchAll(/(?<!\w)10\.\d{4,}\/[^\s,;)>\]]+/g);
    for (const doiMatch of bareDOIMatches) {
      // Skip if this DOI is part of a URL we already matched
      const doi = normalizeDOI(doiMatch[0]);
      if (!isValidDOI(doi)) continue;
      if (seenIds.has(doi)) continue;

      // Check it's not inside a URL
      const matchStart = doiMatch.index!;
      const before = line.substring(0, matchStart);
      if (/https?:\/\/\S*$/.test(before)) continue;

      seenIds.add(doi);
      refs.push({
        type: "doi",
        url: `https://doi.org/${doi}`,
        id: doi,
        title: extractTitleFromLine(line, doiMatch[0]),
      });
    }
  }

  return refs;
}

/**
 * Classify a URL into a reference type and extract metadata.
 */
function classifyUrl(url: string, line: string): ExtractedRef | null {
  // DOI URL: doi.org/10.xxx
  const doiUrlMatch = url.match(/doi\.org\/(10\.\d{4,}\/[^\s,;)>\]]+)/);
  if (doiUrlMatch) {
    const doi = normalizeDOI(doiUrlMatch[1]!);
    if (isValidDOI(doi)) {
      return {
        type: "doi",
        url,
        id: doi,
        title: extractTitleFromLine(line, url),
      };
    }
  }

  // PMC: pmc.ncbi.nlm.nih.gov/articles/PMCxxxxxx
  const pmcMatch = url.match(/pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC\d+)/i);
  if (pmcMatch) {
    return {
      type: "pmc",
      url,
      id: pmcMatch[1]!.toUpperCase(),
      title: extractTitleFromLine(line, url),
    };
  }

  // PMID: pubmed.ncbi.nlm.nih.gov/12345
  const pmidMatch = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
  if (pmidMatch) {
    return {
      type: "pmid",
      url,
      id: pmidMatch[1]!,
      title: extractTitleFromLine(line, url),
    };
  }

  // NCT: clinicaltrials.gov/study/NCTxxxxxxxx
  const nctMatch = url.match(/clinicaltrials\.gov\/study\/(NCT\d+)/i);
  if (nctMatch) {
    return {
      type: "nct",
      url,
      id: nctMatch[1]!.toUpperCase(),
      title: extractTitleFromLine(line, url),
    };
  }

  // ArXiv: arxiv.org/abs/xxxx.xxxxx
  const arxivMatch = url.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/);
  if (arxivMatch) {
    return {
      type: "arxiv",
      url,
      id: arxivMatch[1]!,
      title: extractTitleFromLine(line, url),
    };
  }

  // bioRxiv: biorxiv.org/content/10.1101/2024.01.01.123456
  const biorxivMatch = url.match(/biorxiv\.org\/content\/(10\.1101\/[\d.]+)/);
  if (biorxivMatch) {
    return {
      type: "biorxiv",
      url,
      id: biorxivMatch[1]!,
      title: extractTitleFromLine(line, url),
    };
  }

  // UniProt: uniprot.org/uniprotkb/P12345
  const uniprotMatch = url.match(/uniprot\.org\/uniprotkb\/([A-Z0-9]+)/i);
  if (uniprotMatch) {
    return {
      type: "uniprot",
      url,
      id: uniprotMatch[1]!.toUpperCase(),
      title: extractTitleFromLine(line, url),
    };
  }

  // PubChem: pubchem.ncbi.nlm.nih.gov/compound/2244
  const pubchemMatch = url.match(/pubchem\.ncbi\.nlm\.nih\.gov\/compound\/(\d+)/);
  if (pubchemMatch) {
    return {
      type: "pubchem",
      url,
      id: pubchemMatch[1]!,
      title: extractTitleFromLine(line, url),
    };
  }

  // Generic URL (skip common non-reference URLs)
  if (isNonReferenceUrl(url)) return null;

  return {
    type: "url",
    url,
    id: url,
    title: extractTitleFromLine(line, url),
  };
}

/**
 * Filter out URLs that are not useful references (images, stylesheets, etc.)
 */
function isNonReferenceUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    /\.(png|jpg|jpeg|gif|svg|css|js|ico|woff|woff2|ttf|eot)(\?|$)/.test(lower) ||
    lower.includes("fonts.googleapis.com") ||
    lower.includes("cdn.") ||
    lower.includes("static.")
  );
}

/**
 * Extract a title from the surrounding line context.
 *
 * Patterns:
 * 1. Numbered ref: [1] Title here. Source. https://...
 * 2. Markdown link: [Title](https://...)
 * 3. "Title" before or around the URL on the same line
 * 4. Fallback: hostname + path fragment
 */
function extractTitleFromLine(line: string, urlOrDoi: string): string {
  // Pattern 1: Numbered reference — [1] Title here. Source. https://...
  const numberedRefMatch = line.match(
    /^\s*\[?\d+\]?\s+(.+?)(?:\.\s+\w+\.\s+https?:\/\/|https?:\/\/)/,
  );
  if (numberedRefMatch?.[1]) {
    const title = numberedRefMatch[1].replace(/\.\s*$/, "").trim();
    if (title.length > 5) return truncateTitle(title);
  }

  // Pattern 2: Markdown link — [Title](https://...)
  const mdLinkPattern = new RegExp(
    `\\[([^\\]]+)\\]\\(${escapeRegex(urlOrDoi)}\\)`,
  );
  const mdLinkMatch = line.match(mdLinkPattern);
  if (mdLinkMatch?.[1]) {
    return truncateTitle(mdLinkMatch[1].trim());
  }

  // Pattern 3: Text preceding the URL (after stripping the URL itself)
  const urlIndex = line.indexOf(urlOrDoi);
  if (urlIndex > 0) {
    let preceding = line.substring(0, urlIndex).trim();
    // Strip trailing punctuation and source labels like "GeroScience."
    preceding = preceding.replace(/[\s.,:;-]+$/, "").trim();
    // Strip leading numbering [1] or 1.
    preceding = preceding.replace(/^\s*\[?\d+\]?\s*\.?\s*/, "").trim();
    if (preceding.length > 5) return truncateTitle(preceding);
  }

  // Fallback: hostname + path fragment
  return fallbackTitle(urlOrDoi);
}

const MAX_TITLE_LENGTH = 120;

/**
 * Truncate title to a reasonable length, cutting at a natural boundary.
 */
function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;

  const truncated = title.substring(0, MAX_TITLE_LENGTH);

  // Try to cut at last sentence boundary within limit
  const lastPeriod = truncated.lastIndexOf(". ");
  if (lastPeriod > 30) return truncated.substring(0, lastPeriod);

  // Try comma or semicolon
  const lastComma = truncated.lastIndexOf(", ");
  if (lastComma > 30) return truncated.substring(0, lastComma);

  // Cut at last word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 30) return truncated.substring(0, lastSpace);

  return truncated;
}

/**
 * Generate a fallback title from a URL or DOI string.
 */
function fallbackTitle(urlOrDoi: string): string {
  try {
    const url = new URL(
      urlOrDoi.startsWith("http") ? urlOrDoi : `https://doi.org/${urlOrDoi}`,
    );
    const host = url.hostname.replace(/^www\./, "");
    const pathParts = url.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1] || "";
    return lastPart ? `${host} - ${lastPart}` : host;
  } catch {
    return urlOrDoi.substring(0, 60);
  }
}

/**
 * Convert a reference to a citekey string.
 */
export function refToCitekey(ref: ExtractedRef): string {
  switch (ref.type) {
    case "doi":
      return doiToCitekey(ref.id);
    case "pmc": {
      const numPart = ref.id.replace(/^PMC/i, "");
      return sanitizeCitekey(`pmc_${numPart}`);
    }
    case "pmid":
      return sanitizeCitekey(`pmid_${ref.id}`);
    case "nct": {
      const numPart = ref.id.replace(/^NCT/i, "");
      return sanitizeCitekey(`nct_${numPart}`);
    }
    case "arxiv":
      return sanitizeCitekey(`arxiv_${ref.id.replace(/\./g, "_")}`);
    case "biorxiv":
      return sanitizeCitekey(`biorxiv_${ref.id.replace(/[./]/g, "_")}`);
    case "uniprot":
      return sanitizeCitekey(`uniprot_${ref.id}`);
    case "pubchem":
      return sanitizeCitekey(`pubchem_${ref.id}`);
    case "url":
      return sanitizeCitekey(`url_${simpleHash(ref.url)}`);
  }
}

/**
 * Create a @misc BibTeX entry for a non-DOI reference.
 *
 * Uses `author` field (not `key`) so BibTeX renders the source name
 * in the bibliography instead of a raw citekey with underscores.
 */
export function createMiscBibtexEntry(
  citekey: string,
  title: string,
  url: string,
  note?: string,
): string {
  // Escape BibTeX special chars in title
  const safeTitle = title.replace(/[{}]/g, "").replace(/&/g, "\\&");
  // Double braces prevent BibTeX from parsing as "Last, First"
  const author = note ? `{${note}}` : "{Web Resource}";
  const lines = [
    `@misc{${citekey},`,
    `  author = {${author}},`,
    `  title = {${safeTitle}},`,
    `  url = {${url}},`,
    `  year = {n.d.}`,
  ];

  if (note) {
    lines[lines.length - 1] = `  year = {n.d.},`;
    lines.push(`  note = {${note}}`);
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Get the default note for known reference sources.
 */
export function noteForRefType(ref: ExtractedRef): string | undefined {
  switch (ref.type) {
    case "pmc":
      return "PubMed Central";
    case "pmid":
      return "PubMed";
    case "nct":
      return "ClinicalTrials.gov";
    case "arxiv":
      return "arXiv preprint";
    case "biorxiv":
      return "bioRxiv preprint";
    case "uniprot":
      return "UniProt Database";
    case "pubchem":
      return "PubChem Database";
    default:
      return undefined;
  }
}

/**
 * Deduplicate extracted references by id.
 */
export function deduplicateRefs(refs: ExtractedRef[]): ExtractedRef[] {
  const seen = new Map<string, ExtractedRef>();
  for (const ref of refs) {
    if (!seen.has(ref.id)) {
      seen.set(ref.id, ref);
    }
  }
  return Array.from(seen.values());
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function cleanTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:)>\]]+$/, "");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Simple string hash returning first 8 hex chars.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").substring(0, 8);
}
