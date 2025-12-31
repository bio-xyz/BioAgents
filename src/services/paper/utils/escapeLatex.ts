/**
 * Escape special LaTeX characters in text
 *
 * This is a deterministic function that ensures text can be safely embedded in LaTeX documents.
 * Handles: \ & % $ # _ { } ~ ^
 * Also converts Unicode mathematical symbols and Greek letters to LaTeX equivalents
 */
export function escapeLatex(text: string): string {
  if (!text) return "";

  return text
    // Unicode mathematical symbols (must be before backslash escaping)
    .replace(/≥/g, "$\\geq$")
    .replace(/≤/g, "$\\leq$")
    .replace(/≠/g, "$\\neq$")
    .replace(/≈/g, "$\\approx$")
    .replace(/±/g, "$\\pm$")
    .replace(/×/g, "$\\times$")
    .replace(/÷/g, "$\\div$")
    .replace(/°/g, "$^\\circ$")
    .replace(/→/g, "$\\rightarrow$")
    .replace(/←/g, "$\\leftarrow$")
    .replace(/↔/g, "$\\leftrightarrow$")
    .replace(/∞/g, "$\\infty$")
    // Greek letters
    .replace(/α/g, "$\\alpha$")
    .replace(/β/g, "$\\beta$")
    .replace(/γ/g, "$\\gamma$")
    .replace(/δ/g, "$\\delta$")
    .replace(/ε/g, "$\\epsilon$")
    .replace(/θ/g, "$\\theta$")
    .replace(/λ/g, "$\\lambda$")
    .replace(/μ/g, "$\\mu$")
    .replace(/π/g, "$\\pi$")
    .replace(/σ/g, "$\\sigma$")
    .replace(/τ/g, "$\\tau$")
    .replace(/φ/g, "$\\phi$")
    .replace(/ω/g, "$\\omega$")
    .replace(/Δ/g, "$\\Delta$")
    .replace(/Σ/g, "$\\Sigma$")
    .replace(/Ω/g, "$\\Omega$")
    // Backslash must come after Unicode replacements (to avoid double-escaping)
    .replace(/\\/g, "\\textbackslash{}")
    // Special chars that need escaping
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
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

/**
 * Replace Unicode characters in LaTeX content with proper LaTeX commands
 * This is for cleaning up LLM-generated LaTeX that may contain Unicode symbols
 * NOTE: This does NOT escape LaTeX special characters - use only on already-valid LaTeX
 */
export function replaceUnicodeInLatex(latex: string): string {
  if (!latex) return "";

  return latex
    // Mathematical comparison operators
    .replace(/≥/g, "$\\geq$")
    .replace(/≤/g, "$\\leq$")
    .replace(/≠/g, "$\\neq$")
    .replace(/≈/g, "$\\approx$")
    // Mathematical operators
    .replace(/±/g, "$\\pm$")
    .replace(/×/g, "$\\times$")
    .replace(/÷/g, "$\\div$")
    .replace(/·/g, "$\\cdot$")
    // Arrows
    .replace(/→/g, "$\\rightarrow$")
    .replace(/←/g, "$\\leftarrow$")
    .replace(/↔/g, "$\\leftrightarrow$")
    .replace(/⇒/g, "$\\Rightarrow$")
    .replace(/⇐/g, "$\\Leftarrow$")
    // Other symbols
    .replace(/°/g, "$^\\circ$")
    .replace(/∞/g, "$\\infty$")
    .replace(/∈/g, "$\\in$")
    .replace(/∑/g, "$\\sum$")
    .replace(/∏/g, "$\\prod$")
    .replace(/∫/g, "$\\int$")
    // Greek letters (lowercase)
    .replace(/α/g, "$\\alpha$")
    .replace(/β/g, "$\\beta$")
    .replace(/γ/g, "$\\gamma$")
    .replace(/δ/g, "$\\delta$")
    .replace(/ε/g, "$\\epsilon$")
    .replace(/ζ/g, "$\\zeta$")
    .replace(/η/g, "$\\eta$")
    .replace(/θ/g, "$\\theta$")
    .replace(/ι/g, "$\\iota$")
    .replace(/κ/g, "$\\kappa$")
    .replace(/λ/g, "$\\lambda$")
    .replace(/μ/g, "$\\mu$")
    .replace(/ν/g, "$\\nu$")
    .replace(/ξ/g, "$\\xi$")
    .replace(/π/g, "$\\pi$")
    .replace(/ρ/g, "$\\rho$")
    .replace(/σ/g, "$\\sigma$")
    .replace(/τ/g, "$\\tau$")
    .replace(/υ/g, "$\\upsilon$")
    .replace(/φ/g, "$\\phi$")
    .replace(/χ/g, "$\\chi$")
    .replace(/ψ/g, "$\\psi$")
    .replace(/ω/g, "$\\omega$")
    // Greek letters (uppercase)
    .replace(/Α/g, "$A$") // Capital alpha is just A
    .replace(/Β/g, "$B$") // Capital beta is just B
    .replace(/Γ/g, "$\\Gamma$")
    .replace(/Δ/g, "$\\Delta$")
    .replace(/Ε/g, "$E$") // Capital epsilon is just E
    .replace(/Ζ/g, "$Z$") // Capital zeta is just Z
    .replace(/Η/g, "$H$") // Capital eta is just H
    .replace(/Θ/g, "$\\Theta$")
    .replace(/Λ/g, "$\\Lambda$")
    .replace(/Ξ/g, "$\\Xi$")
    .replace(/Π/g, "$\\Pi$")
    .replace(/Σ/g, "$\\Sigma$")
    .replace(/Φ/g, "$\\Phi$")
    .replace(/Ψ/g, "$\\Psi$")
    .replace(/Ω/g, "$\\Omega$");
}
