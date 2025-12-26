/**
 * LLM prompts for paper generation
 */

import { escapeLatex, truncateText } from "./utils/escapeLatex";
import type { Discovery, PlanTask } from "../../types/core";
import type { FigureInfo } from "./types";

/**
 * Generate prompt for creating a discovery section
 */
export function generateDiscoverySectionPrompt(
  discovery: Discovery,
  discoveryIndex: number,
  allowedTasks: PlanTask[],
  figures: FigureInfo[],
  allowedDOIs: string[],
): string {
  const derivedTitle = discovery.title || `Discovery ${discoveryIndex}`;

  // Prepare task details
  const taskDetails = allowedTasks
    .map((task, idx) => {
      const output = task.output || "(No output available)";
      const truncatedOutput = output.length > 8000 ? truncateText(output, 8000) : output;

      return `### Task ${idx + 1}
Job ID: ${task.jobId || task.id}
Type: ${task.type}
Objective: ${task.objective}

Output:
${truncatedOutput}
`;
    })
    .join("\n\n");

  // Prepare figure list
  const figureList = figures.length > 0
    ? figures
        .map(
          (fig) =>
            `- ${fig.filename}: ${fig.captionSeed} (from task ${fig.sourceJobId})`,
        )
        .join("\n")
    : "(No figures available)";

  // Prepare evidence explanations
  const evidenceExplanations = discovery.evidenceArray
    ?.map((ev) => `- Task ${ev.jobId || ev.taskId}: ${ev.explanation || "(no explanation)"}`)
    .join("\n") || "(No evidence explanations provided)";

  // Prepare allowed DOIs list
  const doiList = allowedDOIs.length > 0
    ? allowedDOIs.map((doi) => `- ${doi}`).join("\n")
    : "(No DOIs found in task outputs)";

  return `You are writing a section for a scientific research paper. Generate a LaTeX section for Discovery ${discoveryIndex}.

# Discovery Information
Title: ${derivedTitle}
Claim: ${discovery.claim}
Summary: ${discovery.summary || "(No summary provided)"}
Novelty: ${discovery.novelty || "(Not assessed)"}
Primary Job ID: ${(discovery as any).jobId || "N/A"}

# Evidence Explanations
${evidenceExplanations}

# Allowed Tasks and Their Outputs
These are the ONLY tasks you may reference in this section. You MUST use information from these tasks to support the discovery.

${taskDetails}

# Available Figures
You may ONLY reference figures from this list. Use \\includegraphics[width=0.8\\textwidth]{filename} to include them.
Set \\graphicspath{{figures/}} so LaTeX can find them.

${figureList}

# Citation Guidelines
You MUST cite sources using DOI placeholders in the format: \\cite{doi:10.xxxx/xxxxx}

You may ONLY cite DOIs that appear verbatim in the task outputs above. Here are the DOIs found:
${doiList}

DO NOT invent or hallucinate DOIs. Only use DOIs from the list above.

# Required Section Structure
Generate a LaTeX section with EXACTLY this structure:

\\section{Discovery ${discoveryIndex}: ${escapeLatex(derivedTitle)}}

\\subsection{Background}
[Provide context and background for this discovery. What was known before? Why is this important?]

\\subsection{Results \\& Discussion}
[Present the main findings and results. Include figures if available. Discuss what these results mean.]
[Use \\includegraphics to embed figures where appropriate]

\\subsection{Novelty}
[Explain what is novel about this discovery. Why is this new or important?]

\\subsection{Tasks Used}
[List the tasks that contributed to this discovery:]
- Task ${(discovery as any).jobId || "N/A"} (primary)
${discovery.evidenceArray?.map((ev) => `- Task ${ev.jobId || ev.taskId}: ${ev.explanation || ""}`).join("\n") || ""}

# Output Format
Return ONLY valid JSON with this structure:
{
  "sectionLatex": "...full LaTeX section...",
  "usedDois": ["10.xxxx/xxxx", "10.yyyy/yyyy"]
}

DO NOT include any markdown code blocks or additional text. Return ONLY the JSON object.

The sectionLatex field must contain valid LaTeX code with:
- Properly escaped special characters
- Valid \\cite{doi:...} commands for references
- Only figures from the available figures list
- All content derived from the allowed tasks

CRITICAL: Use proper LaTeX commands instead of Unicode characters:
- Use $\\geq$ instead of ≥
- Use $\\leq$ instead of ≤
- Use $\\pm$ instead of ±
- Use $\\times$ instead of ×
- Use $\\alpha$, $\\beta$, $\\mu$ etc. instead of Greek letter Unicode characters (α, β, μ)
- Use $\\sim$ for ~, $\\approx$ for ≈, etc.
- DO NOT use any Unicode mathematical symbols or Greek letters directly

Generate the section now:`;
}

/**
 * Generate repair prompt when citations are broken
 */
export function generateRepairPrompt(
  mainTexContent: string,
  unresolvedDOIs: string[],
  missingCitekeys: string[],
  availableCitekeys: string[],
  allowedDOIs: string[],
): string {
  const issues: string[] = [];

  if (unresolvedDOIs.length > 0) {
    issues.push(
      `Unresolved DOIs (could not fetch BibTeX): ${unresolvedDOIs.join(", ")}`,
    );
  }

  if (missingCitekeys.length > 0) {
    issues.push(
      `Citations to citekeys not in references.bib: ${missingCitekeys.join(", ")}`,
    );
  }

  return `You are fixing citation issues in a LaTeX research paper.

# Issues Found
${issues.join("\n")}

# Available Citations
You may cite these DOIs (they have valid BibTeX entries):
${allowedDOIs.length > 0 ? allowedDOIs.map((doi) => `- ${doi}`).join("\n") : "(None available)"}

Available citekeys in references.bib:
${availableCitekeys.length > 0 ? availableCitekeys.join(", ") : "(None)"}

# Task
Fix the LaTeX document by:
1. Removing citations to unresolved DOIs or replacing them with resolvable ones from the allowed list
2. Removing citations to missing citekeys or replacing them with available ones
3. DO NOT add new sections or change the structure
4. DO NOT add DOIs that are not in the allowed list

CRITICAL: Use proper LaTeX commands instead of Unicode characters:
- Use $\\geq$ instead of ≥, $\\leq$ instead of ≤
- Use $\\alpha$, $\\beta$, $\\mu$ etc. instead of Greek letter Unicode (α, β, μ)
- DO NOT use any Unicode mathematical symbols or Greek letters directly

Return ONLY the complete corrected main.tex content. No JSON, no markdown, just the LaTeX source.

# Current main.tex
${mainTexContent}

Return the corrected LaTeX now:`;
}
