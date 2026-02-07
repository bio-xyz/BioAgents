/**
 * Assemble a complete Markdown document with YAML frontmatter from LLM outputs
 */

import * as fs from "fs";
import * as path from "path";
import logger from "../../../utils/logger";
import type { DiscoverySection } from "../types";

export type AssembleMarkdownOptions = {
  title: string;
  authors: string;
  abstract: string;
  researchSnapshot: string;
  background: string;
  discoverySections: DiscoverySection[];
  keyInsights: string[];
  summaryOfDiscoveries: string;
  bibFilename: string; // e.g. "refs.bib"
  outputDir: string; // directory to write paper.md
};

/**
 * Build YAML frontmatter + Markdown body and write to disk
 * Returns the path to the written file
 */
export function assembleMarkdown(opts: AssembleMarkdownOptions): string {
  const {
    title,
    authors,
    abstract,
    researchSnapshot,
    background,
    discoverySections,
    keyInsights,
    summaryOfDiscoveries,
    bibFilename,
    outputDir,
  } = opts;

  // YAML frontmatter
  // Escape YAML special chars in title/abstract by using block scalar
  const frontmatter = [
    "---",
    `title: |`,
    `  ${title}`,
    `author: "${authors.replace(/"/g, '\\"')}"`,
    `abstract: |`,
    ...abstract.split("\n").map((line) => `  ${line}`),
    `bibliography: ${bibFilename}`,
    `header-includes: |`,
    `  \\usepackage{amsmath}`,
    `  \\usepackage{amssymb}`,
    `  \\usepackage{graphicx}`,
    `  \\usepackage{booktabs}`,
    "---",
  ].join("\n");

  // Build body sections
  const sections: string[] = [];

  // Research Snapshot
  sections.push("# Research Snapshot\n");
  sections.push(researchSnapshot);

  // Background
  sections.push("\n# Background\n");
  sections.push(background);

  // Key Insights
  if (keyInsights.length > 0) {
    sections.push("\n# Key Insights\n");
    sections.push(
      keyInsights.map((insight) => `- ${insight}`).join("\n"),
    );
  }

  // Summary of Discoveries
  if (summaryOfDiscoveries) {
    sections.push("\n# Summary of Discoveries\n");
    sections.push(summaryOfDiscoveries);
  }

  // Discovery sections (already contain their own # headings)
  for (const ds of discoverySections) {
    sections.push("\n" + ds.sectionMarkdown);
  }

  const fullDocument = frontmatter + "\n\n" + sections.join("\n") + "\n";

  const outputPath = path.join(outputDir, "paper.md");
  fs.writeFileSync(outputPath, fullDocument, "utf-8");

  logger.info(
    { outputPath, length: fullDocument.length },
    "markdown_document_assembled",
  );

  return outputPath;
}
