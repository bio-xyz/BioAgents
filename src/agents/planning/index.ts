import { LLM } from "../../llm/provider";
import type {
  ConversationState,
  Message,
  PlanTask,
  State,
} from "../../types/core";
import logger from "../../utils/logger";

export type PlanningResult = {
  currentObjective: string;
  plan: Array<PlanTask>;
};

export type PlanningMode = "initial" | "next";

/**
 * Planning agent for deep research
 * Plans next steps based on conversation state and previous results
 *
 * Two modes:
 * - "initial": Creates tasks for the current iteration (default, used at start of each message)
 *              If no plan exists yet, creates an initial literature search plan
 * - "next": Updates plan for next iteration after reflection (used after hypothesis + reflection)
 */
export async function planningAgent(input: {
  state: State;
  conversationState: ConversationState;
  message: Message;
  mode?: PlanningMode;
}): Promise<PlanningResult> {
  const { state, conversationState, message, mode = "initial" } = input;

  // Check if plan is empty (indicates first planning or fresh start)
  const hasPlan =
    conversationState.values.plan && conversationState.values.plan.length > 0;

  // If no existing plan and initial mode, create initial literature search plan
  if (!hasPlan && mode === "initial") {
    logger.info("No existing plan found, planning initial literature search");

    // Use LLM to create a 'search scientific literature' objective for the question
    const specificObjectiveForQuestion =
      await generateSpecificObjectiveForQuestion(message.question);

    return {
      currentObjective:
        "Gather comprehensive literature to understand the current state of research on the deep research topic and inform the next steps.",
      plan: [
        {
          objective: specificObjectiveForQuestion,
          datasets: [],
          type: "LITERATURE",
        },
      ],
    };
  }

  // Otherwise, use LLM to plan based on current state
  return await generatePlan(state, conversationState, message, mode);
}

/**
 * Generate plan using LLM based on current state
 */
async function generatePlan(
  state: State,
  conversationState: ConversationState,
  message: Message,
  mode: PlanningMode = "initial",
): Promise<PlanningResult> {
  const PLANNING_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "google";
  const planningApiKey =
    process.env[`${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!planningApiKey) {
    throw new Error(
      `${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    // @ts-ignore
    name: PLANNING_LLM_PROVIDER,
    apiKey: planningApiKey,
  });

  // Build context from latest results
  const context = buildContextFromState(conversationState);

  // Mode-specific instructions
  const modeInstructions =
    mode === "initial"
      ? `PLANNING MODE: INITIAL
You are planning tasks for the CURRENT iteration based on the user's request.
- Create tasks that will address the user's immediate question
- These tasks will be executed NOW, then a hypothesis will be generated, then the world state will be reflected upon
- Focus on gathering information or performing analysis needed to answer the current question
- You might be provided a plan from the previous iteration and the user's latest message. Use these to plan the next steps`
      : `PLANNING MODE: NEXT
You are planning tasks for the NEXT iteration based on completed work (hypothesis + reflection).
- The current iteration has completed (tasks executed, hypothesis generated, world reflected)
- Now plan what should happen NEXT to advance the research
- Consider what gaps remain, what follow-up questions emerged, or what deeper analysis is needed
- Return an EMPTY plan only if you believe with 100% certainty that the main objective has been achieved and the research is complete`;

  const planningPrompt = `You are a research planning agent. Your job is to plan the NEXT immediate steps based on the current research state.

${modeInstructions}

IMPORTANT INSTRUCTIONS:
- Focus on planning the NEXT steps
- DO NOT plan too far into the future - keep it focused and actionable
- Incorporate latest results into your thinking
- Tasks will be executed in PARALLEL, so if tasks depend on each other, only plan the first ones
- Tailor the objective to the specific type of task
- If you believe the main objective has been achieved, set the objective to "Main objective achieved" and your plan should be empty

CURRENT RESEARCH STATE:
${context}

USER'S LATEST MESSAGE:
${message.question}

AVAILABLE TASK TYPES (only these two):
- LITERATURE: Search and gather scientific papers and knowledge from literature databases. Use it to:
  - Find recent research
  - Search Specialized Medical Databases (UniProt, PubChem...)
  - Compare interventions
  - Find dosing protocols
  - Find clinical trial data
  - Search for molecular mechanisms
  - Search patent databases
  - Search Regulatory and Safety Databases (FDA, EMA, etc.)
  - Search for open source datasets (it's enough to find the dataset name/link and later pass it to the ANALYSIS task)
  - And other similar tasks
- ANALYSIS: Perform computational/data analysis on datasets (which are included in the world state). ANALYSIS tasks have access to a data scientist agent which can execute Python code in notebooks. Use it to:
  - "Which genes show the strongest response to rapamycin treatment in our mouse liver dataset?" → Load RNA-seq data and perform differential expression analysis
  - "Are there patterns in how different longevity compounds affect gene expression in our aging study?" → Cluster analysis on transcriptomic datasets comparing multiple interventions
  - "What's the optimal dose range based on our dose-response survival data?" → Fit curves to uploaded lifespan datasets and find optimal parameters
  - "How do the gene expression signatures compare between our rapamycin and metformin datasets?" → Gene set enrichment analysis comparing two uploaded transcriptome studies
  - "Are the survival differences significant in our treatment groups dataset?" → Statistical analysis of uploaded lifespan/healthspan data
  - "How do aging biomarkers change over time in our longitudinal study?" → Time-series analysis of uploaded longitudinal datasets

  ** Type specific objectives **
  - For LITERATURE tasks: describe the objective simply in 1-2 sentences
  - For ANALYSIS tasks: Describe the objective in this format "GOAL: <goal> DATASETS: <short dataset descriptions> OUTPUT: <desired output>". Each section should be relatively simple, 1-3 sentences max. Do not overexplain so that you allow the data scientist agent to be creative and come up with the best solution. Focus on the what, not on the how.

  OUTPUT FORMAT (respond with ONLY valid JSON):
{
  "currentObjective": "Updated objective for the next phase of research (1-2 sentences)",
  "plan": [
    {
      "objective": "Specific objective tailored to this task",
      "datasets": [{"filename": "example.csv", "id": "dataset-id", "description": "Brief dataset description"}], // Dataset metadata, only for ANALYSIS tasks
      "type": "LITERATURE or ANALYSIS"
    }
  ]
}

NOTES:
- Choose LITERATURE if: You need to find, read, or synthesize information from scientific papers
- Choose ANALYSIS if: You have datasets that need coding, statistics, visualization, or any computational processing
- For LITERATURE tasks: datasets array should be EMPTY []
- For ANALYSIS tasks: SELECT which uploaded datasets (shown in the CURRENT RESEARCH STATE above) are relevant for the analysis task
  - Only include datasets that are directly relevant to the specific analysis objective
  - Copy the exact dataset objects (filename, id, description) from the "Uploaded Datasets" section above
  - If no datasets are uploaded or none are relevant, use an empty array
- Plan only 1-3 tasks maximum
- If tasks depend on each other, only plan the first ones (next ones will be handled in the next iteration). You can express what you're planning to do next in the currentObjective field.
- Update the currentObjective to reflect what you're currently doing and what comes after these tasks
- Be specific and actionable`;

  const response = await llmProvider.createChatCompletion({
    model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-pro",
    messages: [
      {
        role: "user" as const,
        content: planningPrompt,
      },
    ],
    maxTokens: 1024,
  });

  const rawContent = response.content.trim();

  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = rawContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const jsonString = jsonMatch ? jsonMatch[1] || "" : rawContent || "";

  const result = JSON.parse(jsonString) as PlanningResult;

  logger.info(
    {
      mode,
      currentObjective: result.currentObjective,
      plan: result.plan.map(
        (t) =>
          `${t.type} task: ${t.objective} datasets: ${t.datasets.map((d) => `${d.filename} (${d.description})`).join(", ")}`,
      ),
    },
    "plan_generated",
  );

  return result;
}

/**
 * Generate a specific objective for literature search based on the user's question
 */
async function generateSpecificObjectiveForQuestion(
  question: string,
): Promise<string> {
  const PLANNING_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "google";
  const planningApiKey =
    process.env[`${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!planningApiKey) {
    throw new Error(
      `${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    // @ts-ignore
    name: PLANNING_LLM_PROVIDER,
    apiKey: planningApiKey,
  });

  const prompt = `Given this research question, create a specific, focused objective for searching scientific literature.

Research Question: ${question}

Create a clear, actionable objective (1-2 sentences) that describes what literature to search for and what information to gather.

Focus on:
- Key topics and concepts to search
- Relevant scientific domains
- What insights or information are needed

Respond with ONLY the objective text, no additional explanation.`;

  const response = await llmProvider.createChatCompletion({
    model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-pro",
    messages: [
      {
        role: "user" as const,
        content: prompt,
      },
    ],
    maxTokens: 256,
  });

  const objective = response.content.trim();

  logger.info(
    { objective, questionLength: question.length },
    "specific_literature_objective_generated",
  );

  return objective;
}

/**
 * Build context string from current state
 */
function buildContextFromState(conversationState: ConversationState): string {
  const contextParts: string[] = [];

  // Add hypothesis if available
  if (conversationState.values.currentHypothesis) {
    contextParts.push(
      `Current Hypothesis: ${conversationState.values.currentHypothesis}`,
    );
  }

  if (conversationState.values.objective) {
    contextParts.push(
      `Main Objective (the user message that kicked off the research): ${conversationState.values.objective}`,
    );
  }

  if (conversationState.values.currentObjective) {
    contextParts.push(
      `Current Objective (the current goal of the research, updated after each research iteration): ${conversationState.values.currentObjective}`,
    );
  }

  if (conversationState.values.keyInsights?.length) {
    contextParts.push(
      `Key Insights (from the deep research conversation): ${conversationState.values.keyInsights.length}`,
    );
  }

  if (conversationState.values.uploadedDatasets?.length) {
    contextParts.push(
      `Uploaded Datasets:\n${conversationState.values.uploadedDatasets
        .map((ds) => `  - ${ds.filename} (ID: ${ds.id}): ${ds.description}`)
        .join("\n")}`,
    );
  }

  // Add suggested next steps if available (from previous iteration's "next" planning)
  if (conversationState.values.suggestedNextSteps?.length) {
    const suggestionsText = conversationState.values.suggestedNextSteps
      .map((task, i) => {
        let taskText = `  ${i + 1}. [${task.type}] ${task.objective}`;
        if (task.datasets?.length) {
          taskText += `\n     Datasets: ${task.datasets.map((d) => `${d.filename} (${d.id})`).join(", ")}`;
        }
        return taskText;
      })
      .join("\n");

    contextParts.push(
      `Suggested Next Steps (from previous iteration):\n${suggestionsText}\n\nNOTE: The user's message may indicate approval ("okay", "yes", "proceed") or request changes. Consider these suggestions as a starting point but adapt based on user feedback.`,
    );
  }

  return contextParts.length > 0
    ? contextParts.join("\n")
    : "No previous results available";
}
