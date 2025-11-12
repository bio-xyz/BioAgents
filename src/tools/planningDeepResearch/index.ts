import type { WebSearchResult } from "../../llm/types";
import {
  type Message,
  type Paper,
  type State,
  type Tool,
} from "../../types/core";
import logger from "../../utils/logger";

export const planningDeepResearchTool: Tool = {
  name: "PLANNING_DEEP_RESEARCH",
  description: "Plan the agent workflow execution for deep research",
  enabled: true,
  deepResearchEnabled: true,
  execute: async (input: {
    state: State;
    message: Message;
  }): Promise<{
    thought: string;
    text: string;
    actions: string[];
    papers: Paper[];
    webSearchResults: WebSearchResult[];
  }> => {
    const { state, message } = input;

    // in paralel we will kick off KNOWLEDGE, KNOWLEDGE_GRAPH_QUERY, OPENSCHOLAR, SEMANTIC_SCHOLAR
    // SEMANTIC SCHOLAR could be replaced with Edison LITERATURE job
    // we need to await all of them to complete

    logger.info("Starting parallel provider execution for deep research");

    // Import provider tools
    const { knowledgeTool } = await import("../knowledge");
    // const { knowledgeGraphQueryTool } = await import("../knowledgeGraph");
    const { openscholarTool } = await import("../openscholar");
    const { edisonTool } = await import("../edison");

    // Execute providers in parallel
    const literaturePromises = [
      knowledgeTool.execute({ state, message }).catch((err) => {
        logger.error({ err }, "knowledge_tool_failed");
        return null;
      }),
      //   knowledgeGraphQueryTool.execute({ state, message }).catch((err) => {
      //     logger.error({ err }, "knowledge_graph_query_tool_failed");
      //     return null;
      //   }),
      openscholarTool.execute({ state, message }).catch((err) => {
        logger.error({ err }, "open_scholar_tool_failed");
        return null;
      }),
      edisonTool
        .execute({
          state,
          message,
          question: message.question!,
          jobType: "LITERATURE",
        })
        .catch((err) => {
          logger.error({ err }, "edison_literature_tool_failed");
          return null;
        }),
    ];

    await Promise.all(literaturePromises);

    logger.info(
      "Completed parallel literature provider execution for deep research",
    );

    // Then we need to formulate a hypothesis using the tool
    logger.info("Starting hypothesis generation for deep research");

    const { hypothesisDeepResearchTool } = await import(
      "../hypothesis/deepResearch"
    );

    try {
      await hypothesisDeepResearchTool.execute({
        state,
        message,
      });

      logger.info("Completed hypothesis generation for deep research");
    } catch (err) {
      logger.error({ err }, "hypothesis_generation_failed");
      // Continue with workflow even if hypothesis fails
    }

    // we will check the novelty of the hypothesis using PRECEDENT Edison JOB
    // if not novel enough we will repeat hypothesis with some extra inputs, max 3 times total

    logger.info("Starting precedent check for deep research");

    let hypothesisAttempts = 1;
    const MAX_HYPOTHESIS_ATTEMPTS = 3;

    // Loop to check precedent and regenerate hypothesis if needed
    while (hypothesisAttempts <= MAX_HYPOTHESIS_ATTEMPTS) {
      const noveltyQuestion = `You are evaluating the novelty of a research hypothesis. Please assess whether this EXACT research question has been comprehensively answered in the scientific literature.

    Research Hypothesis:
    ${state.values.hypothesis}

    EVALUATION CRITERIA:
    - Has this EXACT question with these SPECIFIC parameters been thoroughly investigated?
    - Are there existing studies that directly address all aspects of this hypothesis?
    - Is the answer already well-established in the scientific consensus?

    BE LENIENT - Answer "YES" (already done) ONLY if:
    ✓ Multiple high-quality studies have directly tested this exact hypothesis
    ✓ The research question is considered definitively answered by the scientific community
    ✓ Recent comprehensive reviews conclude this specific question is resolved

    Answer "NO" (worth pursuing) if:
    ✓ Only tangentially related work exists
    ✓ Similar questions have been studied but with different parameters/methods
    ✓ The field has new tools/data that could provide fresh insights
    ✓ Previous work has contradictory results or methodological limitations
    ✓ The question combines known elements in a novel way
    ✓ Sufficient time has passed that replication/validation would be valuable

    Remember: Science builds incrementally. Even "similar" work can be valuable with new methods, datasets, or perspectives.

    Output format:
    YES/NO (new line after YES/NO)
    [One sentence explaining your decision and recommending how to improve the novelty of the hypothesis in case of YES]

    Example dummy outputs:
    "YES
    The research question has been thoroughly investigated and is well-established in the scientific community. You should do X to improve it.
    "
    "NO
    The research question has not been thoroughly investigated and is not well-established in the scientific community.
    "
    `;

      try {
        logger.info(
          { attempt: hypothesisAttempts },
          "starting_precedent_check",
        );

        const precedentResult = await edisonTool.execute({
          state,
          message,
          question: noveltyQuestion,
          jobType: "PRECEDENT",
        });

        logger.info(
          {
            answer: precedentResult.answer,
            attempt: hypothesisAttempts,
          },
          "precedent_check_completed",
        );

        // Parse the precedent result
        if (precedentResult.answer) {
          const answerLines = precedentResult.answer.trim().split("\n");
          const firstLine = answerLines[0]?.trim().toUpperCase();

          if (firstLine === "YES") {
            // Hypothesis already exists in literature - extract improvement suggestion
            const improvementText = answerLines.slice(1).join("\n").trim();

            logger.info(
              { improvementText, attempt: hypothesisAttempts },
              "hypothesis_not_novel_enough",
            );

            if (improvementText) {
              state.values.noveltyImprovement = improvementText;
            }

            // Check if we can try again
            if (hypothesisAttempts < MAX_HYPOTHESIS_ATTEMPTS) {
              hypothesisAttempts++;

              logger.info(
                { attempt: hypothesisAttempts },
                "regenerating_hypothesis_with_novelty_improvement",
              );

              try {
                await hypothesisDeepResearchTool.execute({
                  state,
                  message,
                });

                logger.info(
                  { attempt: hypothesisAttempts },
                  "hypothesis_regenerated_successfully",
                );

                // Continue loop to check precedent again
                continue;
              } catch (err) {
                logger.error(
                  { err, attempt: hypothesisAttempts },
                  "hypothesis_regeneration_failed",
                );
                // Break on error
                break;
              }
            } else {
              logger.warn(
                "max_hypothesis_attempts_reached_hypothesis_still_not_novel",
              );
              break;
            }
          } else if (firstLine === "NO") {
            logger.info(
              { attempt: hypothesisAttempts },
              "hypothesis_is_novel_enough",
            );
            // Clear novelty improvement and break - hypothesis is novel enough
            state.values.noveltyImprovement = undefined;
            break;
          } else {
            logger.warn(
              { firstLine },
              "unexpected_precedent_response_continuing",
            );
            break;
          }
        } else {
          logger.warn("no_precedent_answer_continuing");
          break;
        }
      } catch (err) {
        logger.error({ err, attempt: hypothesisAttempts }, "precedent_check_failed");
        // Continue with workflow even if precedent check fails
        break;
      }
    }

    // based on users question we will evaluate whether we need to run MOLECULES/ANALYSIS Edison jobs
    // and will run them and await them if needed

    logger.info("Evaluating need for MOLECULES/ANALYSIS Edison jobs");

    const { LLM } = await import("../../llm/provider");

    const analysisJobsPrompt = `You are evaluating the analysis jobs needed for a research hypothesis. Please assess whether the following analysis jobs are needed to validate the hypothesis.

    Initial user question:
    ${message.question}

    Research Hypothesis:
    ${state.values.hypothesis}

    ANALYSIS JOBS:
    - MOLECULES: For molecular design, chemical synthesis, molecular properties, or drug design questions
    - ANALYSIS: For data analysis, computational analysis, or bioinformatic analysis questions

    Respond with ONLY a JSON array of job types that are needed. No explanation.
    Valid outputs:
    []
    ["MOLECULES"]
    ["ANALYSIS"]
    ["MOLECULES", "ANALYSIS"]
    `;

    let neededJobs: string[] = [];

    try {
      const PLANNING_LLM_PROVIDER =
        process.env.PLANNING_LLM_PROVIDER || "google";
      const planningApiKey =
        process.env[`${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY`];

      if (!planningApiKey) {
        logger.warn(
          "Planning API key not configured, skipping analysis jobs evaluation",
        );
      } else {
        const llmProvider = new LLM({
          // @ts-ignore
          name: PLANNING_LLM_PROVIDER,
          apiKey: planningApiKey,
        });

        const response = await llmProvider.createChatCompletion({
          model: process.env.PLANNING_LLM_MODEL || "gemini-2.0-flash-exp",
          messages: [
            {
              role: "user" as const,
              content: analysisJobsPrompt,
            },
          ],
          maxTokens: 100,
        });

        const rawContent = response.content.trim();

        try {
          // Try to extract JSON from markdown code blocks if present
          const jsonMatch = rawContent.match(
            /```(?:json)?\s*(\[[\s\S]*?\])\s*```/,
          );
          const jsonString = jsonMatch ? jsonMatch[1] || "" : rawContent || "";

          neededJobs = JSON.parse(jsonString);

          if (!Array.isArray(neededJobs)) {
            throw new Error("Response is not an array");
          }

          logger.info({ neededJobs }, "analysis_jobs_evaluation_completed");
        } catch (parseErr) {
          logger.error(
            { err: parseErr, rawContent },
            "failed_to_parse_analysis_jobs",
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "analysis_jobs_evaluation_failed");
    }

    // Execute needed Edison jobs in parallel
    if (neededJobs.length > 0) {
      logger.info({ neededJobs }, "starting_analysis_edison_jobs");

      const analysisPromises = neededJobs.map(async (jobType) => {
        try {
          const jobQuestion =
            jobType === "MOLECULES"
              ? `Based on this hypothesis, suggest molecular designs, chemical compounds, or drug candidates that could be investigated: ${state.values.hypothesis}`
              : `Analyze the computational and data analysis approaches needed to test this hypothesis: ${state.values.hypothesis}`;

          await edisonTool.execute({
            state,
            message,
            question: jobQuestion,
            jobType: jobType as "MOLECULES" | "ANALYSIS",
          });

          logger.info({ jobType }, "analysis_edison_job_completed");
        } catch (err) {
          logger.error({ err, jobType }, "analysis_edison_job_failed");
        }
      });

      await Promise.all(analysisPromises);

      logger.info("Completed all analysis Edison jobs");
    } else {
      logger.info("No analysis Edison jobs needed");
    }

    // last thing - call REPLY tool for the final response
    logger.info("Generating final comprehensive response for deep research");

    const { replyTool } = await import("../reply");

    let replyResult = null;

    try {
      replyResult = await replyTool.execute({
        state,
        message,
      });

      logger.info("Completed final response generation for deep research");
    } catch (err) {
      logger.error({ err }, "final_response_generation_failed");
      // Continue - response generation failure shouldn't block completion
    }

    // obsolete providers/actions
    return replyResult as {
      thought: string;
      text: string;
      actions: string[];
      papers: Paper[];
      webSearchResults: WebSearchResult[];
    };
  },
};
