import type { ConversationStateValues, PlanTask } from "../types/core";

/**
 * Strip large fields (binary buffers, parsed text) from state values before
 * persisting to Supabase. Supabase JSONB writes timeout on multi-MB payloads.
 */
export function cleanValues(
  values: Partial<ConversationStateValues>
): Partial<ConversationStateValues> {
  const cleanedValues = { ...values };

  // Strip binary buffers from datasets if present, but PRESERVE content (text)
  if (cleanedValues.uploadedDatasets?.length) {
    cleanedValues.uploadedDatasets = cleanedValues.uploadedDatasets.map((d) => {
      const { buffer: _buffer, ...rest } = d as Record<string, unknown>;
      return rest as (typeof cleanedValues.uploadedDatasets)[number];
    });
  }

  // Strip content/buffers from plan datasets and artifacts if present
  if (cleanedValues.plan?.length) {
    cleanedValues.plan = cleanedValues.plan.map((task: PlanTask) => {
      let cleaned = task;
      if (task.datasets?.length) {
        const cleanedDatasets = task.datasets.map((d) => {
          const { content: _content, ...rest } = d as Record<string, unknown>;
          return rest as (typeof task.datasets)[number];
        });
        cleaned = { ...cleaned, datasets: cleanedDatasets };
      }
      if (task.artifacts?.length) {
        const cleanedArtifacts = task.artifacts.map(({ content: _content, ...rest }) => rest);
        cleaned = { ...cleaned, artifacts: cleanedArtifacts };
      }
      return cleaned;
    });
  }

  // Legacy state docs (pre-2025-11-26) may still carry rawFiles with
  // multi-megabyte buffers/parsedText in Supabase. No current producer writes
  // rawFiles into state; this branch migrates old rows on their next write to
  // avoid re-persisting buffers that caused Supabase timeouts.
  const maybeRawFiles = (cleanedValues as Record<string, unknown>).rawFiles;
  if (Array.isArray(maybeRawFiles) && maybeRawFiles.length > 0) {
    (cleanedValues as Record<string, unknown>).rawFiles = maybeRawFiles.map((f) => {
      if (f && typeof f === "object") {
        const { buffer: _b, parsedText: _p, ...rest } = f as Record<string, unknown>;
        return rest;
      }
      return f;
    });
  }

  return cleanedValues;
}
