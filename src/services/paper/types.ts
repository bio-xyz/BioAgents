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
  sectionMarkdown: string;
  usedDois: string[];
};

export type BibTeXEntry = {
  doi: string; // empty string for non-DOI entries
  citekey: string;
  bibtex: string;
  url?: string; // source URL for non-DOI entries
};

export type PaperMetadata = {
  title: string;
  authors: string;
  abstract: string;
  background: string; // Background/Introduction section (Markdown)
  researchSnapshot: string;
  keyInsights: string[];
  summaryOfDiscoveries: string;
};
