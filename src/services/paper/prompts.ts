/**
 * LLM prompts for paper generation
 */

import { escapeLatex, truncateText } from "./utils/escapeLatex";
import type { Discovery, PlanTask, ConversationStateValues } from "../../types/core";
import type { FigureInfo } from "./types";

/**
 * Generate prompt for creating paper front matter (title, abstract, research snapshot)
 */
export function generateFrontMatterPrompt(
  state: ConversationStateValues,
): string {
  const objective = state.objective || "Not specified";
  const currentObjective = state.currentObjective || objective;
  const currentHypothesis = state.currentHypothesis || "Not specified";
  const methodology = state.methodology || "Not specified";
  const keyInsights = state.keyInsights || [];
  const discoveries = state.discoveries || [];

  const discoverySummaries = discoveries
    .map((d, i) => {
      const title = d.title || `Discovery ${i + 1}`;
      return `${i + 1}. ${title}: ${d.claim}`;
    })
    .join("\n");

  return `You are writing the front matter for a scientific research paper conducted by Aubrai, an AI research agent.

# Research Information

Original Objective: ${objective}

Current Objective: ${currentObjective}

Current Hypothesis: ${currentHypothesis}

Methodology: ${methodology}

Key Insights:
${keyInsights.length > 0 ? keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join("\n") : "None provided"}

Discoveries:
${discoverySummaries || "None"}

# Task

Generate three components for the paper:

1. **Title**: A concise, professional scientific title (max 15 words) that captures the essence of the research. Should be specific and informative, not generic.

2. **Abstract**: A 150-200 word abstract following standard scientific structure:
   - Background/Context (1-2 sentences)
   - Objective (1 sentence)
   - Methods/Approach (1-2 sentences)
   - Key Findings (2-3 sentences)
   - Significance (1 sentence)

3. **Research Snapshot**: A brief 2-3 paragraph overview providing context about the current state of the research, including the current objective, hypothesis, and approach.

# Output Format

Return ONLY valid JSON with this structure:
{
  "title": "Your Scientific Title",
  "abstract": "150-200 word abstract...",
  "researchSnapshot": "2-3 paragraph research snapshot..."
}

# Requirements

- Use proper LaTeX commands, NOT Unicode (e.g., $\\geq$ not ≥, $\\alpha$ not α)
- DO NOT include LaTeX formatting commands (\\section, \\textbf, etc.) - just plain text
- Write in professional, scientific tone
- Be specific and concrete, referencing actual discoveries
- The content should be publication-quality

Generate the front matter now:`;
}

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
Job ID: ${task.jobId}
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

  // Prepare evidence explanations (only use jobId, not taskId)
  const evidenceExplanations = discovery.evidenceArray
    ?.filter((ev) => ev.jobId) // Only include evidence with jobId
    ?.map((ev) => `- Job ID ${ev.jobId}: ${ev.explanation || "(no explanation)"}`)
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
${figures.length > 0 ? "IMPORTANT: You have been provided with the actual figure images above. Carefully analyze each image and integrate insights from what you see into your writing. Reference specific patterns, trends, or visual elements from the images in your Results & Discussion." : ""}

You may ONLY reference figures from this list. Use \\includegraphics[width=0.8\\textwidth]{filename} to include them.
Set \\graphicspath{{figures/}} so LaTeX can find them.

${figureList}

# Citation Guidelines
CRITICAL: You MUST cite sources using EXACT format: \\cite{doi:10.xxxx/xxxxx}

Rules:
- Format: \\cite{doi:10.1234/example} (NO SPACES in the citation key)
- Multiple citations: \\cite{doi:10.1234/a,doi:10.5678/b} (comma-separated, NO SPACES)
- DO NOT use spaces: \\cite{doi 10 1234} is INVALID
- DO NOT use underscores: \\cite{doi_10_1234} is INVALID (that comes later)
- Use the EXACT DOI from the list below (including case and punctuation)

You may ONLY cite DOIs that appear verbatim in the task outputs above. Here are the DOIs found:
${doiList}

DO NOT invent or hallucinate DOIs. Only use DOIs from the list above.

# Required Section Structure
Generate a LaTeX section with EXACTLY this structure:

\\section{Discovery ${discoveryIndex}: ${escapeLatex(derivedTitle)}}

\\subsection{Background}
[Provide context and background for this discovery. What was known before? Why is this important?]

\\subsection{Results \\& Discussion}
[Present the main findings and results.]
${figures.length > 0 ? "[CRITICAL: You have been shown the actual figure images above. Analyze what you see in each image and integrate those visual insights here. Reference specific patterns, trends, data points, or visual elements you observe. Include the figures using \\includegraphics{filename} with \\caption{description based on what you see in the image}.]" : "[Include figures if available using \\includegraphics.]"}
[Discuss what these results mean and how the visual evidence supports the claims.]

\\subsection{Novelty}
[Explain what is novel about this discovery. Why is this new or important?]

\\subsection{Tasks Used}
[List the tasks that contributed to this discovery. IMPORTANT: Use ONLY the Job IDs provided below, NOT any abbreviated task IDs like "ana-3":]
${discovery.evidenceArray && discovery.evidenceArray.length > 0
  ? discovery.evidenceArray
      .filter((ev) => ev.jobId) // Only include evidence with jobId
      .map((ev) => `- Job ID: ${ev.jobId}: ${ev.explanation || ""}`)
      .join("\n")
  : "(No tasks with job IDs found)"
}

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

