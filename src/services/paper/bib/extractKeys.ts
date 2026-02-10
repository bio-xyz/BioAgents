/**
 * Extract citation keys + metadata from BibTeXEntry array
 *
 * Used to inject available citation keys into LLM prompts
 * so the model knows which [@key] citations are valid.
 */

import type { BibTeXEntry } from "../types";

export type CitationKeyInfo = {
  key: string;
  doi: string; // may be empty for URL refs
  url?: string; // for non-DOI refs
  title: string;
  author: string; // may be empty for URL refs
};

/**
 * Extract citation key metadata from BibTeX entries for prompt injection
 */
export function extractCitationKeys(
  entries: BibTeXEntry[],
): CitationKeyInfo[] {
  return entries.map((entry) => {
    const title = extractBibtexField(entry.bibtex, "title");
    const author = extractBibtexField(entry.bibtex, "author");

    return {
      key: entry.citekey,
      doi: entry.doi,
      url: entry.url,
      title,
      author,
    };
  });
}

/**
 * Extract a field value from a BibTeX entry string
 */
function extractBibtexField(bibtex: string, field: string): string {
  const pattern = new RegExp(
    `${field}\\s*=\\s*[{"]([^}"]+)[}"]`,
    "i",
  );
  const match = bibtex.match(pattern);
  return match?.[1]?.trim() || "";
}
