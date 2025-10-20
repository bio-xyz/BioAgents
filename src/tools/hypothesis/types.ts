import { z } from "zod";

export type KGPaper = { doi: string; title: string; abstract: string };
export type OSPaper = { doi: string; title: string; chunkText: string };

export const HypothesisZodSchema = z
  .object({
    hypothesis: z
      .string()
      .min(1)
      .describe(
        "ONE specific, testable hypothesis statement with clear methodology (one sentence)",
      ),
    rationale: z
      .string()
      .min(1)
      .describe(
        "Brief explanation of why this hypothesis is worth testing based on the evidence (one sentence)",
      ),
    supportingPapers: z
      .array(z.string())
      .describe(
        '["Short Description (2-4 words) DOI1", "Short Description (2-4 words) DOI2", "Short Description (2-4 words) DOI3"] // Only DOIs actually provided in previous_results; if none, leave empty',
      ),
    experimentalDesign: z
      .string()
      .min(1)
      .describe("Brief outline of how this could be tested (one sentence)"),
    keywords: z
      .array(z.string())
      .describe(
        '["keyword1", "keyword2", "keyword3"] // Keywords from the hypothesis',
      ),
    webSearchResults: z
      .array(z.string())
      .describe(
        '["Short Description (2-4 words) LINK1", "Short Description (2-4 words) LINK2"] // Web results used for context; include short label and URL',
      ),
  })
  .strict();

export type THypothesisZod = z.infer<typeof HypothesisZodSchema>;

// raw schema
export const FULL_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:schema:output-collection",
  $defs: {
    Output: {
      title: "Output",
      type: "object",
      properties: {
        hypothesis: {
          title: "Hypothesis",
          type: "string",
          description:
            "ONE specific, testable hypothesis statement with clear methodology (one sentence)",
        },
        rationale: {
          title: "Rationale",
          type: "string",
          description:
            "Brief explanation of why this hypothesis is worth testing based on the evidence (one sentence)",
        },
        supporting_papers: {
          title: "Supporting Papers",
          type: "array",
          items: { type: "string" },
          description:
            '["DOI1", "DOI2", "DOI3"], // Only include DOIs that were actually provided in previous_results. If there are no relevant papers in the previous step results, do not include any',
        },
        experimental_design: {
          title: "Experimental Design",
          type: "string",
          description:
            "Brief outline of how this could be tested (one sentence)",
        },
        keywords: {
          title: "Keywords",
          type: "array",
          items: { type: "string" },
          description:
            '["keyword1", "keyword2", "keyword3"] // Keywords from the hypothesis',
        },
        web_search_results: {
          title: "Web Search Results",
          type: "array",
          items: { type: "string" },
          description:
            '["Short Description (2-4 words) LINK1", "Short Description (2-4 words) LINK2"] // Web results used for context; include short label and URL',
        },
      },
      required: [
        "hypothesis",
        "rationale",
        "supporting_papers",
        "experimental_design",
        "keywords",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
} as const;

export const INPUT_SCHEMA = (FULL_SCHEMA as any).$defs.Output;
