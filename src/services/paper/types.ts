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
  sourceZipUrl?: string;
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
  objective: string;
  keyInsights: string[];
  researchSnapshot: string;
  summaryOfDiscoveries: string;
};
