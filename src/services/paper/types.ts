/**
 * Type definitions for paper generation service
 */

import type { ConversationStateValues, PlanTask, Discovery } from "../../types/core";

export type PaperGenerationResult = {
  paperId: string;
  conversationId: string;
  conversationStateId: string;
  pdfPath: string;
  pdfUrl?: string;
  rawLatexUrl?: string; // URL to raw main.tex file
};

export type FigureInfo = {
  filename: string; // Stable filename in latex/figures/
  captionSeed: string; // Description or fallback caption
  sourceJobId: string; // Which task this figure came from
  originalPath: string; // Original artifact path
};

export type DiscoverySection = {
  discoveryIndex: number;
  sectionLatex: string;
  usedDois: string[];
};

export type BibTeXEntry = {
  doi: string;
  citekey: string;
  bibtex: string;
};

export type DiscoveryContext = {
  discovery: Discovery;
  index: number;
  allowedTasks: PlanTask[];
  figures: FigureInfo[];
};

export type PaperMetadata = {
  title: string;
  authors: string; // LaTeX-formatted author string
  abstract: string;
  background: string; // Background/Introduction section
  researchSnapshot: string;
  keyInsights: string[];
  summaryOfDiscoveries: string;
  inlineBibliography: string; // BibTeX from inline DOI citations (for reference)
  inlineBibEntries: BibTeXEntry[]; // Structured BibTeX entries from inline DOI citations
  inlineDOIToCitekey: Map<string, string>; // DOI → author-year citekey mapping for inline citations
};
