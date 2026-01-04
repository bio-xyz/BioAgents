/**
 * Escape special LaTeX characters in text
 *
 * This function escapes problematic plain-text characters for LaTeX documents.
 * It does NOT escape: \ $ { } (these are valid LaTeX syntax used by math mode)
 * It DOES escape: & % # ~ ^ _ (these cause LaTeX errors in plain text)
 *
 * NOTE: With XeLaTeX, Unicode characters (Greek letters, accents, primes, etc.)
 * are handled natively - no conversion needed.
 */
export function escapeLatex(text: string): string {
  if (!text) return "";

  return text
    // Special chars that need escaping (NOT \ $ { } - these are valid LaTeX)
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/#/g, "\\#")
    .replace(/~/g, "\\textasciitilde{}")
    // Escape underscores only outside math mode
    .replace(/([^$])_([^$])/g, "$1\\_$2")
    // Handle standalone ^ outside math mode
    .replace(/([^$\\])\^([^{$])/g, "$1\\textasciicircum{}$2");
}

/**
 * Sanitize filename for safe use in LaTeX \includegraphics
 * Replaces spaces and special chars with underscores
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_"); // Collapse multiple underscores
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

