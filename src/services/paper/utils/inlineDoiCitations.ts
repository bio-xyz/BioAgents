import logger from "../../../utils/logger";
import type { BibTeXEntry } from "../types";
import {
  decodeHtmlEntitiesForLatex,
  extractAndSanitizeBibTeXEntry,
  resolveDOIToBibTeX,
} from "./bibtex";
import { doiToCitekey, isValidDOI, normalizeDOI } from "./doi";

export interface InlineDOIResult {
  updatedText: string;
  referencesBib: string;
  bibEntries: Array<{ doi: string; citekey: string; bibtex: string }>; // Added: structured entries
  doiToCitekey: Map<string, string>;
  unresolvedDOIs: string[];
}
export function extractInlineDOIs(text: string): Array<{
  fullMatch: string;
  startIndex: number;
  dois: string[];
  prefix: string;
}> {
  const results: Array<{
    fullMatch: string;
    startIndex: number;
    dois: string[];
    prefix: string;
  }> = [];

  const pattern =
    /(\([^)]*\))?\s*\[(https?:\/\/)?(doi\.org\/\.org\/|doi\.org\/|doi:)?(10\.[^\]]+)\]/gi;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const prefix = match[1] || "";
    const doiPart = match[4];

    const doiCandidates = doiPart!
      .split(/[;,]/)
      .map((d) => d.trim())
      .filter((d) => d.length > 0);

    const validDOIs: string[] = [];
    for (const candidate of doiCandidates) {
      const cleaned = candidate
        .replace(/^(https?:\/\/)?(doi\.org\/\.org\/|doi\.org\/|doi:)?/, "")
        .replace(/[\]\-),;.\s]+$/, "")
        .trim();

      const normalized = normalizeDOI(cleaned);
      if (isValidDOI(normalized)) {
        validDOIs.push(normalized);
      } else {
        logger.warn({ candidate, normalized }, "invalid_inline_doi");
      }
    }

    if (validDOIs.length > 0) {
      results.push({
        fullMatch,
        startIndex: match.index,
        dois: validDOIs,
        prefix,
      });
    }
  }

  return results;
}

export function replaceInlineDOIsWithCitations(
  text: string,
  doiMatches: Array<{
    fullMatch: string;
    startIndex: number;
    dois: string[];
    prefix: string;
  }>,
): string {
  const sortedMatches = [...doiMatches].sort(
    (a, b) => b.startIndex - a.startIndex,
  );
  let result = text;

  for (const match of sortedMatches) {
    const citations = match.dois.map((doi) => `doi:${doi}`);
    const citationCmd = `\\cite{${citations.join(",")}}`;
    const replacement = match.prefix
      ? `${match.prefix} ${citationCmd}`
      : citationCmd;

    result =
      result.substring(0, match.startIndex) +
      replacement +
      result.substring(match.startIndex + match.fullMatch.length);
  }

  return result;
}
export async function processInlineDOICitations(
  text: string,
): Promise<InlineDOIResult> {
  const matches = extractInlineDOIs(text);
  const allDOIs = Array.from(new Set(matches.flatMap((m) => m.dois)));

  logger.info({ count: allDOIs.length }, "processing_inline_dois");

  const updatedText = replaceInlineDOIsWithCitations(text, matches);
  const bibEntries: BibTeXEntry[] = [];
  const unresolvedDOIs: string[] = [];

  for (const doi of allDOIs) {
    const bibtex = await resolveDOIToBibTeX(doi);
    if (bibtex) {
      const result = extractAndSanitizeBibTeXEntry(bibtex);

      if (result) {
        bibEntries.push({
          doi,
          citekey: result.citekey,
          bibtex: result.bibtex,
        });
      } else {
        const fallbackKey = doiToCitekey(doi);
        // Decode HTML entities in fallback path (XeLaTeX handles Unicode natively)
        const sanitizedBibtex = decodeHtmlEntitiesForLatex(bibtex);
        logger.warn({ doi, fallbackKey }, "inline_doi_fallback_citekey");
        bibEntries.push({ doi, citekey: fallbackKey, bibtex: sanitizedBibtex });
      }
    } else {
      unresolvedDOIs.push(doi);
      logger.warn({ doi }, "inline_doi_unresolved");
    }
  }

  const referencesBib = generateBibTeXContent(bibEntries);
  const doiToCitekeyMap = new Map(bibEntries.map((e) => [e.doi, e.citekey]));

  logger.info(
    { resolved: bibEntries.length, unresolved: unresolvedDOIs.length },
    "inline_dois_processed",
  );

  return {
    updatedText,
    referencesBib,
    bibEntries,
    doiToCitekey: doiToCitekeyMap,
    unresolvedDOIs,
  };
}

function generateBibTeXContent(entries: BibTeXEntry[]): string {
  if (entries.length === 0) return "% No references\n";

  const header = `% BibTeX references from inline DOI citations\n\n`;
  const bibContent = entries
    .map((entry) => `% DOI: ${entry.doi}\n${entry.bibtex}\n`)
    .join("\n");

  return header + bibContent;
}
