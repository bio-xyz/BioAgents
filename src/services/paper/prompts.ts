/**
 * LLM prompts for paper generation (Markdown output pipeline)
 */

import { truncateText } from "./utils/escapeLatex";
import type { Discovery, PlanTask, ConversationStateValues } from "../../types/core";
import type { FigureInfo } from "./types";
import type { CitationKeyInfo } from "./bib/extractKeys";

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

  const agentName = process.env.AGENT_NAME;
  const agentDescription = agentName
    ? `conducted by ${agentName}, an AI research agent`
    : "conducted by an AI research agent";

  return `You are writing the front matter for a scientific research paper ${agentDescription}.

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

- Write plain text. For math, use $...$ for inline and $$...$$ for display.
- DO NOT include any formatting commands - just plain text
- Write in professional, scientific tone
- Be specific and concrete, referencing actual discoveries
- The content should be publication-quality

Generate the front matter now:`;
}

/**
 * Generate prompt for creating Background/Introduction section
 * @param state - Conversation state
 * @param evidenceTasks - Tasks referenced in discovery evidence
 * @param availableKeys - Citation keys available for [@key] references
 */
export function generateBackgroundPrompt(
  state: ConversationStateValues,
  evidenceTasks: PlanTask[],
  availableKeys: CitationKeyInfo[],
): string {
  const objective = state.objective || "Not specified";
  const currentObjective = state.currentObjective || objective;
  const currentHypothesis = state.currentHypothesis || "Not specified";
  const methodology = state.methodology || "Not specified";

  // Prepare task details
  const taskDetails = evidenceTasks
    .map((task, idx) => {
      const output = task.output || "(No output available)";
      const truncatedOutput = output.length > 5000 ? truncateText(output, 5000) : output;

      return `### Task ${idx + 1}
Job ID: ${task.jobId}
Type: ${task.type}
Objective: ${task.objective}

Output:
${truncatedOutput}
`;
    })
    .join("\n\n");

  // Get discovery summaries for context
  const discoveries = state.discoveries || [];
  const discoverySummaries = discoveries
    .map((d, i) => `${i + 1}. ${d.title || `Discovery ${i + 1}`}: ${d.claim}`)
    .join("\n");

  const literatureTaskCount = evidenceTasks.filter(t => t.type === "LITERATURE").length;
  const analysisTaskCount = evidenceTasks.filter(t => t.type === "ANALYSIS").length;

  const agentName = process.env.AGENT_NAME;
  const agentDescription = agentName
    ? `conducted by ${agentName}, an AI research agent`
    : "conducted by an AI research agent";

  // Format available citation keys for the prompt
  const keyList = availableKeys.length > 0
    ? availableKeys
        .map((k) => {
          const source = k.doi ? `DOI: ${k.doi}` : `URL: ${k.url}`;
          return `- [@${k.key}]: ${k.author ? `${k.author}. ` : ""}${k.title || "(no title)"} (${source})`;
        })
        .join("\n")
    : "(No citation keys available)";

  return `You are writing the Background/Introduction section for a scientific research paper ${agentDescription}.

# Research Context

Original Research Objective: ${objective}

Current Research Objective: ${currentObjective}

Current Hypothesis: ${currentHypothesis}

Methodology Approach: ${methodology}

Key Discoveries Made:
${discoverySummaries || "None yet"}

# Available Tasks from Research
You have access to ${evidenceTasks.length} tasks that contributed to this research (${literatureTaskCount} literature reviews, ${analysisTaskCount} analyses).

${taskDetails}

# Task

Generate a comprehensive Background section that serves as the introduction to the paper. This section should:

1. **Context & Motivation** (2-3 paragraphs):
   - Provide broad scientific context for the research area
   - Explain why this research is important and timely
   - Build motivation for why this work was undertaken
   - Use information from ALL available tasks to establish context

2. **Problem Statement** (1-2 paragraphs):
   - Clearly articulate the specific problem or knowledge gap
   - Connect to the research objective
   - Explain what is currently unknown or unresolved

3. **Literature Overview** (2-3 paragraphs):
   - **IMPORTANT: Focus primarily on LITERATURE tasks (type: LITERATURE) for this subsection**
   - Synthesize key findings from the literature review tasks
   - Provide a high-level overview of relevant prior work
   - Show how existing literature supports or contextualizes this research
   - Identify gaps or questions that this research addresses
   - Cite sources using Pandoc citation syntax: [@key]

4. **Research Approach** (1 paragraph):
   - Brief overview of how this research addresses the problem
   - Connect the hypothesis to the gaps identified
   - Can reference analysis tasks to preview the approach

# Output Format

Return ONLY valid JSON with this structure:
{
  "background": "The complete Background section content as Markdown (4-7 paragraphs total)..."
}

# Requirements

- Write in Markdown format
- For math, use $...$ for inline and $$...$$ for display
- DO NOT include section headings (no # or ##) - just flowing paragraphs
- Write in professional, scientific tone appropriate for a research paper introduction
- For the Literature Overview subsection, focus on LITERATURE type tasks
- The content should flow naturally as a cohesive introduction
- Total length: 4-7 well-developed paragraphs (approximately 500-800 words)

# Citation Guidelines

Use Pandoc citation syntax: [@key] for parenthetical citations.
ONLY use keys from the provided list below. Do NOT invent citation keys.
Multiple citations: [@key1; @key2]

Available citation keys:
${keyList}

DO NOT make up or hallucinate citations. Only use keys from the list above.

Generate the Background section now:`;
}

/**
 * Generate prompt for creating a discovery section (Markdown output)
 */
export function generateDiscoverySectionPrompt(
  discovery: Discovery,
  discoveryIndex: number,
  allowedTasks: PlanTask[],
  figures: FigureInfo[],
  availableKeys: CitationKeyInfo[],
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

  // Format available citation keys for the prompt
  const keyList = availableKeys.length > 0
    ? availableKeys
        .map((k) => {
          const source = k.doi ? `DOI: ${k.doi}` : `URL: ${k.url}`;
          return `- [@${k.key}]: ${k.author ? `${k.author}. ` : ""}${k.title || "(no title)"} (${source})`;
        })
        .join("\n")
    : "(No citation keys available)";

  return `You are writing a section for a scientific research paper. Generate a Markdown section for Discovery ${discoveryIndex}.

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

You may ONLY reference figures from this list. Use Markdown image syntax: ![caption](figures/filename.png)
Pandoc will convert these to proper LaTeX \\begin{figure}+\\includegraphics.

${figureList}

# Citation Guidelines
Use Pandoc citation syntax: [@key] for parenthetical citations.
ONLY use keys from the provided list below. Do NOT invent citation keys.
Multiple citations: [@key1; @key2]

Available citation keys:
${keyList}

DO NOT make up or hallucinate citations. Only use keys from the list above.

# Required Section Structure
Generate a Markdown section with this structure:

# Discovery ${discoveryIndex}: ${derivedTitle}

## Background
[Provide context and background for this discovery. What was known before? Why is this important?]

## Results & Discussion
[Present the main findings and results.]
${figures.length > 0 ? "[CRITICAL: You have been shown the actual figure images above. Analyze what you see in each image and integrate those visual insights here. Include figures using ![caption](figures/filename.png).]" : "[Include figures if available using ![caption](figures/filename.png).]"}
[Discuss what these results mean and how the visual evidence supports the claims.]

## Novelty
[Explain what is novel about this discovery. Why is this new or important?]

## Tasks Used
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
  "sectionMarkdown": "...full Markdown section...",
  "usedDois": ["10.xxxx/xxxx", "10.yyyy/yyyy"]
}

DO NOT include any markdown code blocks or additional text. Return ONLY the JSON object.

The sectionMarkdown field must contain valid Markdown with:
- [@key] citations from the available keys list
- Only figures from the available figures list using ![caption](figures/filename.png)
- All content derived from the allowed tasks
- For math, use $...$ for inline and $$...$$ for display

Generate the section now:`;
}
