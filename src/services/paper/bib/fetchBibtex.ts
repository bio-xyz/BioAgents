/**
 * Fetch BibTeX entries for references and write to disk
 *
 * Handles both DOI-based references (resolved via doi.org/Crossref)
 * and non-DOI references (PMC, PMID, NCT, ArXiv, generic URLs) as @misc entries.
 */

import * as fs from "fs";
import logger from "../../../utils/logger";
import type { BibTeXEntry } from "../types";
import {
  deduplicateAndResolveCollisions,
  generateBibTeXFile,
  resolveMultipleDOIs,
} from "../utils/bibtex";
import type { ExtractedRef } from "./extractRefs";
import { createMiscBibtexEntry, noteForRefType, refToCitekey } from "./extractRefs";
export async function fetchAndWriteBibtex(
  refs: ExtractedRef[],
  outputPath: string
): Promise<{ bibPath: string; entries: BibTeXEntry[] }> {
  logger.info({ outputPath, refCount: refs.length }, "fetching_bibtex_for_refs");

  // Split refs by type: DOIs get full metadata, others get @misc entries
  const doiRefs = refs.filter((r) => r.type === "doi");
  const nonDoiRefs = refs.filter((r) => r.type !== "doi");

  // Resolve DOI refs via doi.org / Crossref
  const doiEntries = await resolveMultipleDOIs(doiRefs.map((r) => r.id));

  // Create @misc entries for non-DOI refs (titles from regex extraction)
  const miscEntries: BibTeXEntry[] = nonDoiRefs.map((ref) => {
    const citekey = refToCitekey(ref);
    const note = noteForRefType(ref);
    const bibtex = createMiscBibtexEntry(citekey, ref.title, ref.url, note);
    return {
      bibtex,
      citekey,
      doi: "",
      url: ref.url,
    };
  });

  // Merge and deduplicate
  const allEntries = [...doiEntries, ...miscEntries];
  const deduped = deduplicateAndResolveCollisions(allEntries);
  const bibContent = generateBibTeXFile(deduped);

  fs.writeFileSync(outputPath, bibContent, "utf-8");

  logger.info(
    {
      bibPath: outputPath,
      doiCount: doiRefs.length,
      miscCount: miscEntries.length,
      resolved: deduped.length,
    },
    "bibtex_file_written"
  );

  return { bibPath: outputPath, entries: deduped };
}
