import type { OnPollUpdate } from "../../types/core";
import logger from "../../utils/logger";
import {
  searchVariants,
  getVariantDetail,
  getFindings,
  getAnnotations,
  getClinicalData,
} from "./api";
import { parseVariantFromObjective } from "./parser";

export type ClarityResult = {
  objective: string;
  output: string;
  jobId?: string;
  reasoning?: string[];
  start: string;
  end: string;
};

/**
 * Clarity Protocol agent for deep research
 * Independent agent that queries protein fold data, clinical annotations,
 * and agent findings from Clarity Protocol's API.
 *
 * Flow:
 * 1. Parse objective to extract protein name and variant
 * 2. Search Clarity Protocol for matching fold
 * 3. Fetch variant detail (confidence scores, pLDDT, AI summary)
 * 4. Fetch agent findings and annotations
 * 5. Fetch clinical data (ClinVar + gnomAD)
 * 6. Format all results into structured output
 */
export async function clarityAgent(input: {
  objective: string;
  onPollUpdate?: OnPollUpdate;
}): Promise<ClarityResult> {
  const { objective, onPollUpdate } = input;
  const start = new Date().toISOString();

  logger.info({ objective }, "clarity_agent_started");

  const reasoning: string[] = [];

  function addReasoning(step: string) {
    reasoning.push(step);
    if (onPollUpdate) {
      try {
        const result = onPollUpdate({ reasoning });
        if (result instanceof Promise) {
          result.catch((err: unknown) =>
            logger.warn({ err }, "clarity_on_poll_update_failed"),
          );
        }
      } catch (err) {
        logger.warn({ err }, "clarity_on_poll_update_failed");
      }
    }
  }

  let output: string;

  try {
    // Step 1: Parse protein and variant from objective
    const parsed = parseVariantFromObjective(objective);
    if (!parsed) {
      output =
        "Could not extract protein name and variant from the objective. " +
        "Please specify a protein variant (e.g., 'SOD1 A4V', 'tau P301L').";
      logger.warn({ objective }, "clarity_agent_no_variant_parsed");
      return { objective, output, reasoning, start, end: new Date().toISOString() };
    }

    const { protein, variant } = parsed;
    addReasoning(`Parsed variant: ${protein} ${variant}`);

    // Step 2: Search for the variant in Clarity Protocol
    addReasoning(`Searching Clarity Protocol for ${protein} variants...`);
    const variants = await searchVariants(protein);

    // Find matching variant (protein name may include variant, e.g. "SOD1 A4V")
    const targetName = `${protein} ${variant}`.toLowerCase();
    const matchedVariant = variants.find(
      (v) => v.protein_name.toLowerCase() === targetName,
    ) || variants.find(
      (v) => v.protein_name.toLowerCase().includes(variant.toLowerCase()),
    );

    if (!matchedVariant) {
      output =
        `No fold data found for ${protein} ${variant} in Clarity Protocol. ` +
        `Searched ${variants.length} variant(s) for protein "${protein}". ` +
        (variants.length > 0
          ? `Available variants: ${variants.map((v) => v.protein_name).join(", ")}`
          : "No variants found for this protein.");

      addReasoning(`No matching variant found among ${variants.length} results`);
      return { objective, output, reasoning, start, end: new Date().toISOString() };
    }

    const foldId = matchedVariant.id;
    addReasoning(`Found fold ID ${foldId} for ${matchedVariant.protein_name}`);

    // Steps 3-6: Fetch all data in parallel
    addReasoning("Fetching variant detail, findings, annotations, and clinical data...");

    const [detail, findings, annotations, clinicalData] = await Promise.all([
      getVariantDetail(foldId).catch((err) => {
        logger.error({ err, foldId }, "clarity_variant_detail_failed");
        return null;
      }),
      getFindings(foldId).catch((err) => {
        logger.error({ err, foldId }, "clarity_findings_failed");
        return [] as Awaited<ReturnType<typeof getFindings>>;
      }),
      getAnnotations(foldId).catch((err) => {
        logger.error({ err, foldId }, "clarity_annotations_failed");
        return [] as Awaited<ReturnType<typeof getAnnotations>>;
      }),
      getClinicalData(protein, variant).catch((err) => {
        logger.error({ err, protein, variant }, "clarity_clinical_failed");
        return null;
      }),
    ]);

    addReasoning(
      `Retrieved: detail=${detail ? "yes" : "no"}, ` +
      `findings=${findings.length}, annotations=${annotations.length}, ` +
      `clinical=${clinicalData ? "yes" : "no"}`,
    );

    // Step 7: Format results
    output = formatClarityOutput(protein, variant, detail, findings, annotations, clinicalData);

    addReasoning("Formatted Clarity Protocol data into structured output");
  } catch (err) {
    logger.error({ err, objective }, "clarity_agent_failed");
    output = `Error querying Clarity Protocol: ${err instanceof Error ? err.message : "Unknown error"}`;
  }

  const end = new Date().toISOString();

  logger.info(
    { objective, outputLength: output.length },
    "clarity_agent_completed",
  );

  return {
    objective,
    output,
    reasoning,
    start,
    end,
  };
}

function formatClarityOutput(
  protein: string,
  variant: string,
  detail: Awaited<ReturnType<typeof getVariantDetail>> | null,
  findings: Awaited<ReturnType<typeof getFindings>>,
  annotations: Awaited<ReturnType<typeof getAnnotations>>,
  clinicalData: Awaited<ReturnType<typeof getClinicalData>> | null,
): string {
  const sections: string[] = [];

  sections.push(`# Clarity Protocol Data: ${protein} ${variant}\n`);
  sections.push(`Source: https://clarityprotocol.io\n`);

  // Fold prediction detail
  if (detail) {
    sections.push(`## Structural Prediction (AlphaFold2 via ColabFold)\n`);
    sections.push(`- **Overall Confidence:** ${(detail.overall_confidence * 100).toFixed(1)}%`);
    sections.push(`- **Disease Category:** ${detail.disease_category}`);

    if (detail.plddt_average !== null) {
      sections.push(`- **Mean pLDDT Score:** ${detail.plddt_average.toFixed(1)}`);
    }
    if (detail.plddt_very_high !== null) {
      sections.push(`- **pLDDT Very High (>90):** ${detail.plddt_very_high.toFixed(1)}%`);
    }
    if (detail.plddt_confident !== null) {
      sections.push(`- **pLDDT Confident (70-90):** ${detail.plddt_confident.toFixed(1)}%`);
    }
    if (detail.plddt_low !== null) {
      sections.push(`- **pLDDT Low (50-70):** ${detail.plddt_low.toFixed(1)}%`);
    }
    if (detail.plddt_very_low !== null) {
      sections.push(`- **pLDDT Very Low (<50):** ${detail.plddt_very_low.toFixed(1)}%`);
    }

    if (detail.ai_summary) {
      sections.push(`\n### AI Structural Summary\n${detail.ai_summary}`);
    }

    if (detail.research_brief) {
      sections.push(`\n### Research Brief\n${detail.research_brief}`);
    }

    sections.push("");
  }

  // Clinical data
  if (clinicalData) {
    sections.push(`## Clinical Data\n`);

    if (clinicalData.clinvar) {
      sections.push(`### ClinVar`);
      if (clinicalData.clinvar.clinical_significance) {
        sections.push(`- **Clinical Significance:** ${clinicalData.clinvar.clinical_significance}`);
      }
      if (clinicalData.clinvar.review_status) {
        sections.push(`- **Review Status:** ${clinicalData.clinvar.review_status}`);
      }
      if (clinicalData.clinvar.last_evaluated) {
        sections.push(`- **Last Evaluated:** ${clinicalData.clinvar.last_evaluated}`);
      }
      if (clinicalData.clinvar.conditions && clinicalData.clinvar.conditions.length > 0) {
        sections.push(`- **Conditions:** ${clinicalData.clinvar.conditions.join(", ")}`);
      }
    } else {
      sections.push(`### ClinVar\nNo ClinVar data available.`);
    }

    if (clinicalData.gnomad) {
      sections.push(`\n### gnomAD Population Data`);
      if (clinicalData.gnomad.allele_frequency !== null) {
        sections.push(`- **Allele Frequency:** ${clinicalData.gnomad.allele_frequency.toExponential(4)}`);
      }
      if (clinicalData.gnomad.allele_count !== null) {
        sections.push(`- **Allele Count:** ${clinicalData.gnomad.allele_count}`);
      }
      if (clinicalData.gnomad.allele_number !== null) {
        sections.push(`- **Allele Number:** ${clinicalData.gnomad.allele_number}`);
      }
      if (clinicalData.gnomad.homozygote_count !== null) {
        sections.push(`- **Homozygote Count:** ${clinicalData.gnomad.homozygote_count}`);
      }
    } else {
      sections.push(`\n### gnomAD\nNo gnomAD data available.`);
    }

    sections.push("");
  }

  // Agent findings
  if (findings.length > 0) {
    sections.push(`## Agent Research Findings (${findings.length})\n`);
    for (const finding of findings) {
      sections.push(`### [${finding.agent_type}] ${finding.title}`);
      sections.push(finding.content);
      if (finding.source_url) {
        sections.push(`Source: ${finding.source_url}`);
      }
      sections.push(`_${finding.finding_type} — ${finding.created_at}_\n`);
    }
  }

  // Agent annotations
  if (annotations.length > 0) {
    sections.push(`## Agent Annotations (${annotations.length})\n`);
    for (const annotation of annotations) {
      sections.push(
        `- **[${annotation.agent_id}]** (${annotation.annotation_type}, confidence: ${annotation.confidence}): ${annotation.content}`,
      );
    }
    sections.push("");
  }

  if (!detail && !clinicalData && findings.length === 0 && annotations.length === 0) {
    sections.push(
      `No detailed data available for ${protein} ${variant} in Clarity Protocol.`,
    );
  }

  return sections.join("\n");
}
