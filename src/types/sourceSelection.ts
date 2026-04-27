import { z } from "zod";

export const SOURCE_SELECTION_IDS = [
  "alphafold_db",
  "uniprot",
  "alphafold_model",
] as const;

export type SourceSelectionId = (typeof SOURCE_SELECTION_IDS)[number];

export const SourceSelectionIdSchema = z.enum(SOURCE_SELECTION_IDS);

export function parseSourceSelectionId(value: unknown): SourceSelectionId | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const result = SourceSelectionIdSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }

  return result.data;
}
