import { z } from 'zod';

// Zod Schemas
export const PlanStepSchema = z.object({
  step: z.number(),
  type: z.string(),
  inputs: z.object({
    concepts: z.array(z.string()).optional(),
    authors: z.array(z.string()).optional(),
    papers: z.array(z.string()).optional(),
    previous_results: z.any().optional(),
  }),
  depends_on: z.array(z.number()),
});

export const ExecutionPlanSchema = z.object({
  plan: z.array(PlanStepSchema),
});

export const PaperSchema = z.object({
  doi: z.string(),
  title: z.string(),
  abstract: z.string(),
  termName: z.string().optional(),
  termDescription: z.string().optional(),
});

export const PaperSummarySchema = z.object({
  papers: z.array(PaperSchema),
  count: z.number(),
  overview: z.string(),
});

export const PaperDetailsSchema = z.object({
  paper: z.string(),
  title: z.string(),
  abstract: z.string(),
  allTermNames: z.string().optional(),
  allTermDescriptions: z.string().optional(),
  allKeywords: z.string().optional(),
  allAuthorNames: z.string().optional(),
});

export const SuggestedTermSchema = z.object({
  relatedTermName: z.string(),
  relatedTermDescription: z.string(),
});

export const SimilarTermsSchema = z.object({
  suggested_terms: z.array(SuggestedTermSchema),
});

export const HypothesesSchema = z.object({
  hypothesis: z.string(),
  rationale: z.string(),
  supporting_papers: z.array(z.string()),
  experimental_design: z.string(),
  keywords: z.array(z.string()),
});
