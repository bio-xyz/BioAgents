/**
 * Fetch BibTeX entries for DOIs and write to disk
 *
 * Thin wrapper around resolveMultipleDOIs + generateBibTeXFile
 */

import * as fs from "fs";
import logger from "../../../utils/logger";
import type { BibTeXEntry } from "../types";
import {
  deduplicateAndResolveCollisions,
  generateBibTeXFile,
  resolveMultipleDOIs,
} from "../utils/bibtex";

export async function fetchAndWriteBibtex(
  dois: string[],
  outputPath: string,
): Promise<{ bibPath: string; entries: BibTeXEntry[] }> {
  logger.info({ doiCount: dois.length, outputPath }, "fetching_bibtex_for_dois");

  const entries = await resolveMultipleDOIs(dois);
  const deduped = deduplicateAndResolveCollisions(entries);
  const bibContent = generateBibTeXFile(deduped);

  fs.writeFileSync(outputPath, bibContent, "utf-8");

  logger.info(
    { resolved: deduped.length, total: dois.length, bibPath: outputPath },
    "bibtex_file_written",
  );

  return { bibPath: outputPath, entries: deduped };
}
