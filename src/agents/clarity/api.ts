import { fetchWithRetry } from "../../utils/fetchWithRetry";
import logger from "../../utils/logger";

// Types for Clarity Protocol API responses

export type ClarityVariantSummary = {
  id: number;
  protein_name: string;
  disease_category: string;
  overall_confidence: number;
  plddt_average: number | null;
  created_at: string;
};

export type ClarityVariantDetail = {
  id: number;
  protein_name: string;
  disease_category: string;
  overall_confidence: number;
  plddt_average: number | null;
  plddt_very_high: number | null;
  plddt_confident: number | null;
  plddt_low: number | null;
  plddt_very_low: number | null;
  ai_summary: string | null;
  research_brief: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ClarityFinding = {
  id: number;
  fold_id: number;
  agent_type: string;
  finding_type: string;
  title: string;
  content: string;
  source_url: string | null;
  created_at: string;
};

export type ClarityAnnotation = {
  id: number;
  fold_id: number;
  agent_id: string;
  annotation_type: string;
  content: string;
  confidence: string;
  created_at: string;
};

export type ClarityClinicalData = {
  gene: string;
  variant: string;
  clinvar: {
    clinical_significance: string | null;
    review_status: string | null;
    last_evaluated: string | null;
    conditions: string[];
  } | null;
  gnomad: {
    allele_frequency: number | null;
    homozygote_count: number | null;
    allele_count: number | null;
    allele_number: number | null;
  } | null;
};

function getBaseUrl(): string {
  return (
    process.env.CLARITY_API_URL?.replace(/\/$/, "") ||
    "https://clarityprotocol.io/api/v1"
  );
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.CLARITY_API_KEY;
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

/**
 * Search for variants by protein name.
 * GET /api/v1/variants?protein_name={protein}
 */
export async function searchVariants(
  proteinName: string,
): Promise<ClarityVariantSummary[]> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/variants?protein_name=${encodeURIComponent(proteinName)}`;

  logger.info({ proteinName, url }, "clarity_searching_variants");

  const { response } = await fetchWithRetry(url, {
    method: "GET",
    headers: getHeaders(),
  }, {
    maxRetries: 3,
    initialDelayMs: 2000,
    onRetry: (attempt, error) =>
      logger.warn({ attempt, proteinName, error: error.message }, "clarity_search_variants_retry"),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Clarity API error searching variants: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return (Array.isArray(data) ? data : data.variants || data.results || []) as ClarityVariantSummary[];
}

/**
 * Get full variant detail including AI summary and pLDDT breakdown.
 * GET /api/v1/variants/{foldId}
 */
export async function getVariantDetail(
  foldId: number,
): Promise<ClarityVariantDetail> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/variants/${foldId}`;

  logger.info({ foldId, url }, "clarity_getting_variant_detail");

  const { response } = await fetchWithRetry(url, {
    method: "GET",
    headers: getHeaders(),
  }, {
    maxRetries: 3,
    initialDelayMs: 2000,
    onRetry: (attempt, error) =>
      logger.warn({ attempt, foldId, error: error.message }, "clarity_variant_detail_retry"),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Clarity API error getting variant detail: ${response.status} - ${errorText}`);
  }

  return (await response.json()) as ClarityVariantDetail;
}

/**
 * Get agent findings for a variant.
 * GET /api/v1/variants/{foldId}/findings
 */
export async function getFindings(
  foldId: number,
): Promise<ClarityFinding[]> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/variants/${foldId}/findings`;

  logger.info({ foldId }, "clarity_getting_findings");

  const { response } = await fetchWithRetry(url, {
    method: "GET",
    headers: getHeaders(),
  }, {
    maxRetries: 3,
    initialDelayMs: 2000,
    onRetry: (attempt, error) =>
      logger.warn({ attempt, foldId, error: error.message }, "clarity_findings_retry"),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Clarity API error getting findings: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return (Array.isArray(data) ? data : data.findings || []) as ClarityFinding[];
}

/**
 * Get structured annotations for a variant.
 * GET /api/v1/variants/{foldId}/annotations
 */
export async function getAnnotations(
  foldId: number,
): Promise<ClarityAnnotation[]> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/variants/${foldId}/annotations`;

  logger.info({ foldId }, "clarity_getting_annotations");

  const { response } = await fetchWithRetry(url, {
    method: "GET",
    headers: getHeaders(),
  }, {
    maxRetries: 3,
    initialDelayMs: 2000,
    onRetry: (attempt, error) =>
      logger.warn({ attempt, foldId, error: error.message }, "clarity_annotations_retry"),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Clarity API error getting annotations: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return (Array.isArray(data) ? data : data.annotations || []) as ClarityAnnotation[];
}

/**
 * Get clinical data (ClinVar + gnomAD) for a gene/variant.
 * GET /api/v1/clinical/{gene}/{variant}
 */
export async function getClinicalData(
  gene: string,
  variant: string,
): Promise<ClarityClinicalData | null> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/clinical/${encodeURIComponent(gene)}/${encodeURIComponent(variant)}`;

  logger.info({ gene, variant }, "clarity_getting_clinical_data");

  const { response } = await fetchWithRetry(url, {
    method: "GET",
    headers: getHeaders(),
  }, {
    maxRetries: 3,
    initialDelayMs: 2000,
    onRetry: (attempt, error) =>
      logger.warn({ attempt, gene, variant, error: error.message }, "clarity_clinical_retry"),
  });

  if (!response.ok) {
    if (response.status === 404) {
      logger.info({ gene, variant }, "clarity_no_clinical_data");
      return null;
    }
    const errorText = await response.text();
    throw new Error(`Clarity API error getting clinical data: ${response.status} - ${errorText}`);
  }

  return (await response.json()) as ClarityClinicalData;
}
