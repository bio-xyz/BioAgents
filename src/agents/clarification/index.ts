/**
 * Clarification Agent
 *
 * Generates clarification questions and research plans for the
 * pre-research clarification flow.
 *
 * Two main entry points:
 * - clarificationQuestionsAgent: Generates 1-3 clarification questions
 * - clarificationPlanAgent: Generates a research plan from answers
 */

import type {
  ClarificationAnswer,
  ClarificationPlan,
  ClarificationQuestion,
} from "../../types/clarification";
import logger from "../../utils/logger";
import { generatePlanFromContext, regeneratePlanFromFeedback } from "./plan";
import { generateQuestions, type DatasetInfo } from "./utils";

export type ClarificationQuestionsResult = {
  questions: ClarificationQuestion[];
  reasoning: string;
  start: string;
  end: string;
};

export type ClarificationPlanResult = {
  plan: ClarificationPlan;
  start: string;
  end: string;
};

/**
 * Generate clarification questions for a research query
 *
 * This agent analyzes the user's research query and generates 1-3
 * clarification questions across four categories:
 * - ambiguity: Vague terms, unclear scope
 * - data_requirements: User data, data sources
 * - scope_constraints: Species, time period, disease context
 * - methodology: Analysis approaches, statistical methods
 *
 * If datasets are provided, the agent will be aware of what data the user has
 * and can ask more relevant questions about data usage.
 */
export async function clarificationQuestionsAgent(input: {
  query: string;
  datasets?: DatasetInfo[];
}): Promise<ClarificationQuestionsResult> {
  const { query, datasets } = input;
  const start = new Date().toISOString();

  logger.info(
    { queryLength: query.length, queryPreview: query.substring(0, 100), datasetCount: datasets?.length || 0 },
    "clarification_questions_agent_started",
  );

  try {
    const result = await generateQuestions(query, { datasets });

    const end = new Date().toISOString();

    logger.info(
      {
        questionCount: result.questions.length,
        categories: result.questions.map((q) => q.category),
        reasoning: result.reasoning,
      },
      "clarification_questions_agent_completed",
    );

    return {
      questions: result.questions,
      reasoning: result.reasoning,
      start,
      end,
    };
  } catch (error) {
    logger.error({ error, query }, "clarification_questions_agent_failed");
    throw error;
  }
}

/**
 * Generate a research plan from clarification answers
 *
 * This agent takes the user's answers to clarification questions
 * and generates a focused research plan with:
 * - Refined objective
 * - Research approach
 * - Initial tasks (LITERATURE and/or ANALYSIS)
 * - Estimated iterations
 * - Constraints from user answers
 */
export async function clarificationPlanAgent(input: {
  query: string;
  questions: ClarificationQuestion[];
  answers: ClarificationAnswer[];
  datasets?: Array<{ filename: string; description?: string }>;
}): Promise<ClarificationPlanResult> {
  const { query, questions, answers, datasets } = input;
  const start = new Date().toISOString();

  logger.info(
    {
      queryLength: query.length,
      questionCount: questions.length,
      answerCount: answers.length,
      datasetCount: datasets?.length || 0,
    },
    "clarification_plan_agent_started",
  );

  try {
    const plan = await generatePlanFromContext({
      query,
      questions,
      answers,
      datasets,
    });

    const end = new Date().toISOString();

    logger.info(
      {
        objective: plan.objective.substring(0, 100),
        taskCount: plan.initialTasks.length,
      },
      "clarification_plan_agent_completed",
    );

    return {
      plan,
      start,
      end,
    };
  } catch (error) {
    logger.error({ error, query }, "clarification_plan_agent_failed");
    throw error;
  }
}

/**
 * Regenerate a research plan based on user feedback
 *
 * This agent takes user feedback on a previous plan and regenerates
 * it while addressing their concerns.
 */
export async function clarificationPlanRegenerateAgent(input: {
  query: string;
  questions: ClarificationQuestion[];
  answers: ClarificationAnswer[];
  previousPlan: ClarificationPlan;
  feedback: string;
  datasets?: Array<{ filename: string; description?: string }>;
}): Promise<ClarificationPlanResult> {
  const { query, questions, answers, previousPlan, feedback, datasets } = input;
  const start = new Date().toISOString();

  logger.info(
    {
      queryLength: query.length,
      feedbackLength: feedback.length,
      previousTaskCount: previousPlan.initialTasks.length,
      datasetCount: datasets?.length || 0,
    },
    "clarification_plan_regenerate_agent_started",
  );

  try {
    const plan = await regeneratePlanFromFeedback({
      query,
      questions,
      answers,
      previousPlan,
      feedback,
      datasets,
    });

    const end = new Date().toISOString();

    logger.info(
      {
        objective: plan.objective.substring(0, 100),
        taskCount: plan.initialTasks.length,
      },
      "clarification_plan_regenerate_agent_completed",
    );

    return {
      plan,
      start,
      end,
    };
  } catch (error) {
    logger.error(
      { error, query, feedback },
      "clarification_plan_regenerate_agent_failed",
    );
    throw error;
  }
}

// Re-export types and utilities
export { generateQuestions } from "./utils";
export { generatePlanFromContext, regeneratePlanFromFeedback } from "./plan";
