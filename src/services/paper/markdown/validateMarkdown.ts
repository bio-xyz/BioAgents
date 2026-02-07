/**
 * Validate assembled Markdown before Pandoc conversion
 *
 * Checks for unknown citation keys, unbalanced math delimiters,
 * and empty sections.
 */

import logger from "../../../utils/logger";

/**
 * Validate Markdown content and return cleaned version
 *
 * @param markdown - The assembled Markdown document
 * @param knownKeys - Set of valid citation keys from the .bib file
 * @returns Validated (and potentially cleaned) Markdown string
 */
export function validateMarkdown(
  markdown: string,
  knownKeys: Set<string>,
): string {
  let result = markdown;

  // 1. Citation key check — strip unknown [@key] references
  result = validateCitationKeys(result, knownKeys);

  // 2. Math balance check — warn about unmatched $ delimiters
  checkMathBalance(result);

  // 3. Empty section check
  checkEmptySections(result);

  return result;
}

/**
 * Extract all [@key] and @key references, remove unknown ones
 */
function validateCitationKeys(
  markdown: string,
  knownKeys: Set<string>,
): string {
  const unknownKeys: string[] = [];

  // Match Pandoc citation patterns: [@key], [@key1; @key2], @key
  // Pattern for bracketed citations: [@key] or [@key1; @key2]
  const bracketedPattern = /\[([^\]]*@[^\]]+)\]/g;

  const cleaned = markdown.replace(bracketedPattern, (fullMatch, inner: string) => {
    // Parse individual citations within brackets
    const citations = inner.split(";").map((c: string) => c.trim());
    const validCitations: string[] = [];

    for (const citation of citations) {
      // Extract the key from @key or -@key (suppress author)
      const keyMatch = citation.match(/-?@([^\s,;\]]+)/);
      if (!keyMatch) {
        // Not a citation, keep as-is (could be other bracket content)
        validCitations.push(citation);
        continue;
      }

      const key = keyMatch[1]!;
      if (knownKeys.has(key)) {
        validCitations.push(citation);
      } else {
        unknownKeys.push(key);
      }
    }

    if (validCitations.length === 0) {
      // All citations were unknown — remove the entire bracket
      return "";
    }

    return `[${validCitations.join("; ")}]`;
  });

  if (unknownKeys.length > 0) {
    logger.warn(
      { unknownKeys: unknownKeys.slice(0, 20), total: unknownKeys.length },
      "unknown_citation_keys_removed",
    );
  }

  return cleaned;
}

/**
 * Check for unmatched $ delimiters in Markdown
 * Only warns — does not modify content
 */
function checkMathBalance(markdown: string): void {
  // Remove $$ (display math) first, then check single $
  const withoutDisplay = markdown.replace(/\$\$[^$]*\$\$/g, "");

  // Count remaining single $ (inline math delimiters)
  const dollarCount = (withoutDisplay.match(/\$/g) || []).length;

  if (dollarCount % 2 !== 0) {
    logger.warn(
      { dollarCount },
      "unbalanced_math_delimiters_detected",
    );
  }
}

/**
 * Check for empty or suspiciously short sections
 */
function checkEmptySections(markdown: string): void {
  const sectionPattern = /^(#{1,3})\s+(.+)$/gm;
  const sections: Array<{ heading: string; startIndex: number }> = [];

  let match;
  while ((match = sectionPattern.exec(markdown)) !== null) {
    sections.push({
      heading: match[2]!,
      startIndex: match.index + match[0].length,
    });
  }

  const emptySections: string[] = [];

  for (let i = 0; i < sections.length; i++) {
    const start = sections[i]!.startIndex;
    const end = i + 1 < sections.length
      ? markdown.lastIndexOf("\n", markdown.indexOf(sections[i + 1]!.heading, start))
      : markdown.length;

    const content = markdown.slice(start, end).trim();
    if (content.length < 20) {
      emptySections.push(sections[i]!.heading);
    }
  }

  if (emptySections.length > 0) {
    logger.warn(
      { emptySections },
      "empty_or_short_sections_detected",
    );
  }
}
