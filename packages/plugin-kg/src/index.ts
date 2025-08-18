import type { Plugin, UUID } from '@elizaos/core';
import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type ProviderResult,
  type State,
  logger,
  MESSAGE_STATE,
} from '@elizaos/core';
import { z } from 'zod';
import { KnowledgeGraphService } from './kg-service';
import { PLANNING_PROMPT, SPARQL_TOOLS, HYPOTHESIS_TOOLS } from './constants/prompts';
import { ExecutionPlan, QueryStep, StepResult } from './constants/types';
import {
  generateFinalSynthesis,
  callOpenAIWithLangfuse,
  getTwitterHandleFromEntities,
} from './helpers';
import { ExecutionPlanSchema } from './constants/schemas';

/**
 * Define the configuration schema for the knowledge graph plugin
 */
const configSchema = z.object({
  KG_TRIPLE_STORE_URL: z
    .string()
    .min(1, 'Knowledge graph endpoint is required')
    .optional()
    .transform((val) => {
      if (!val) {
        console.warn('Warning: Knowledge graph endpoint not provided');
      }
      return val;
    }),
});

/**
 * Knowledge Graph Query Provider
 * Queries the knowledge graph based on recent conversation context
 */

const queryProvider: Provider = {
  name: 'KNOWLEDGE_GRAPH_QUERY',
  position: 0,
  description:
    'Queries the knowledge graph to provide relevant context based on conversation. Only run this tool if the researcher (user) can be assisted by querying the Knowledge Graph of science papers.',
  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> => {
    try {
      const room = await runtime.getRoom(message.roomId);
      // Broadcast KNOWLEDGE-GRAPH state when this provider starts executing
      await runtime.broadcastMessageState(
        room?.channelId as UUID,
        MESSAGE_STATE.KNOWLEDGE_GRAPH,
        message.id
      );

      const kgService = runtime.getService('knowledge-graph') as KnowledgeGraphService;
      // Get the recentMessages string from your state
      const recentMessages = state.values.recentMessages;

      // Split into lines
      const lines = recentMessages.trim().split('\n');

      // Find the indices of lines that start a new message (look for the timestamp pattern)
      const messageStartIndices = lines
        .map((line: string, idx: number) => (/^\d{2}:\d{2}/.test(line) ? idx : null))
        .filter((idx: number | null) => idx !== null) as number[];

      // Get the last 3 message start indices
      const last3Indices = messageStartIndices.slice(-3);

      // Extract the messages as text blocks
      const latestMessages = last3Indices.map((startIdx: number, i: number) => {
        const endIdx = last3Indices[i + 1] || lines.length;
        return lines.slice(startIdx, endIdx).join('\n');
      });

      // Remove the current message (last one) and get the previous two
      const previousMessages = latestMessages.slice(0, -1);
      const lastTwo = previousMessages.slice(-2);

      // Function to clean metadata and keep only the message content, and remove all @twitterusername tags from anywhere in the message
      function cleanMessage(msg: string) {
        // Remove metadata up to the first colon and space after the username
        let content = msg.replace(/^.*?:\s*/, '');
        // Remove all @twitterusername tags (e.g., @foobar) from anywhere in the message
        content = content.replace(/@\w+/g, '');
        // Remove any extra whitespace left by tag removal
        content = content.replace(/\s{2,}/g, ' ').trim();
        return content;
      }

      const cleanedLastTwoMessages = lastTwo.map(cleanMessage);
      // TODO: consider last few msgs instead of only one
      const question = message.content.text;

      const cacheKey = `data:${question}:${message.roomId}`;

      const cachedData = await runtime.getCache(cacheKey);

      if (cachedData) {
        console.log('🔍 Returning cached data for question:', question);
        return cachedData;
      }

      if (!question) {
        return {
          text: 'No question provided',
          values: {},
          data: {},
        };
      }

      console.log('🔍 Processing research question:', question);

      // Step 1: Generate execution plan with Langfuse tracking
      const planMessages = [
        { role: 'system' as const, content: PLANNING_PROMPT },
        {
          role: 'user' as const,
          content: `Context (previous two messages): ${cleanedLastTwoMessages.join('\n\n')}\n\nActual question: ${question}`,
        },
      ];

      const planContent = await callOpenAIWithLangfuse(
        runtime,
        planMessages,
        process.env.KG_GENERATION_MODEL || 'gpt-4.1',
        0.2,
        3000,
        'kg-plugin-planning'
      );
      let executionPlan: ExecutionPlan;

      try {
        const cleanedContent = planContent
          ?.replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();
        const parsedPlan = JSON.parse(cleanedContent || '{}');
        // @ts-ignore
        executionPlan = ExecutionPlanSchema.parse(parsedPlan);
      } catch (error) {
        console.error('Failed to parse execution plan:', planContent);
        throw new Error('Failed to parse execution plan');
      }

      console.log('📋 Generated execution plan:', JSON.stringify(executionPlan, null, 2));

      // Step 2: Execute steps with parallel processing where possible
      const results: StepResult[] = [];
      const contextData: Map<string, any> = new Map();
      const usedPapers: Array<{
        doi: string;
        title?: string;
        abstract?: string;
      }> = [];

      // Group steps by dependency level
      const dependencyLevels: QueryStep[][] = [];
      const remainingSteps = [...executionPlan.plan];

      while (remainingSteps.length > 0) {
        const executableSteps = remainingSteps.filter((step) => step.depends_on.length === 0);

        if (executableSteps.length === 0) {
          throw new Error('Circular dependency detected in execution plan');
        }

        dependencyLevels.push(executableSteps);

        executableSteps.forEach((executedStep) => {
          const index = remainingSteps.findIndex((s) => s.step === executedStep.step);
          remainingSteps.splice(index, 1);

          remainingSteps.forEach((step) => {
            step.depends_on = step.depends_on.filter((depStep) => depStep !== executedStep.step);
          });
        });
      }

      // Execute steps level by level
      for (let levelIndex = 0; levelIndex < dependencyLevels.length; levelIndex++) {
        const levelSteps = dependencyLevels[levelIndex];
        const levelPromises = levelSteps.map(async (step) => {
          console.log(`\n🚀 Executing Step ${step.step} (${step.type})`);

          const previousResults = step.depends_on.map((depStep) => {
            const result = results.find((r) => r.step === depStep);
            return {
              step: depStep,
              output: result?.processed_output,
            };
          });

          const isSparqlStep = Object.keys(SPARQL_TOOLS).includes(step.type);
          const isHypothesisStep = Object.keys(HYPOTHESIS_TOOLS).includes(step.type);

          let stepResult: StepResult;

          if (previousResults.length > 0) {
            step.inputs = {
              ...step.inputs,
              previous_results: previousResults,
            };
          }

          if (isSparqlStep) {
            stepResult = await kgService.executeSparqlStep(step, contextData, question, runtime);
            if (stepResult.data?.results?.bindings) {
              const papers = stepResult.data.results.bindings;
              stepResult.papers = papers;
              usedPapers.push(
                ...papers.map((p: any) => ({
                  doi: p.doi.value,
                  title: p.title?.value,
                  abstract: p.abstract?.value,
                }))
              );
            }
          } else if (isHypothesisStep) {
            const hypothesisCreator =
              message.content.source === 'twitter'
                ? (getTwitterHandleFromEntities(state.values.entities) ?? runtime.character?.name)
                : runtime.character?.name;
            console.log('🔍 Hypothesis creator:', hypothesisCreator);
            stepResult = await kgService.executeHypothesisStep(
              step,
              contextData,
              question,
              runtime,
              hypothesisCreator
            );
          } else {
            throw new Error(`Unknown step type: ${step.type}`);
          }

          return stepResult;
        });

        const levelResults = await Promise.all(levelPromises);

        // Check if this is the first level (level 0) and all SPARQL steps have 0 results
        if (levelIndex === 0) {
          const firstLevelSparqlSteps = levelResults.filter((result, index) =>
            Object.keys(SPARQL_TOOLS).includes(levelSteps[index].type)
          );

          if (firstLevelSparqlSteps.length > 0) {
            const allSparqlStepsHaveNoResults = firstLevelSparqlSteps.every(
              (result) =>
                result.paper_count === 0 ||
                (result.data?.results?.bindings && result.data.results.bindings.length === 0)
            );

            if (allSparqlStepsHaveNoResults) {
              console.log('All SPARQL queries returned no results');
              throw new Error('All SPARQL queries returned no results');
            }
          }
        }

        levelResults.forEach((stepResult) => {
          contextData.set(`step_${stepResult.step}`, stepResult.processed_output);
          contextData.set(`step_${stepResult.step}_raw`, stepResult.data);

          if (
            stepResult.paper_count === null ||
            stepResult.paper_count === undefined ||
            (typeof stepResult.paper_count === 'number' && stepResult.paper_count > 0)
          ) {
            results.push(stepResult);
          }
          console.log(`✅ Step ${stepResult.step} completed`);
        });
      }

      // Step 3: Generate final synthesis
      const finalSynthesis = await generateFinalSynthesis(question, results, runtime);

      console.log('🎯 Multi-step analysis complete, generating final synthesis', finalSynthesis);

      // Remove duplicates by doi
      const finalPapers = Array.from(new Map(usedPapers.map((p) => [p.doi, p])).values());

      const result = {
        text: 'Science knowledge graph final synthesis: ' + finalSynthesis,
        values: {
          finalSynthesis,
          finalPapers: finalPapers,
          paperDois: finalPapers.map((p) => p.doi).join(', '),
          numberOfPapers: finalPapers.length,
        },
        data: {
          question,
          numPapers: finalPapers.length,
          papers: finalPapers,
          success: true,
        },
      };

      await runtime.updateAnswerEval(message.id as string, {
        knowledgeGraphSynthesis: finalSynthesis,
        knowledgeGraphChunks: finalPapers,
      });

      await runtime.setCache(cacheKey, result);

      return result;
    } catch (error) {
      logger.error('Error in knowledge graph query provider:', error);

      const result = {
        text: 'Unable to query knowledge graph',
        values: {},
        data: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        },
      };

      const cacheKey = `data:${message.content.text}:${message.roomId}`;

      await runtime.setCache(cacheKey, result);

      return result;
    }
  },
};

const plugin: Plugin = {
  name: 'kg-plugin',
  description: 'A plugin for querying and managing knowledge graph interactions.',
  priority: 0,
  config: {
    KG_TRIPLE_STORE_URL: process.env.KG_TRIPLE_STORE_URL,
  },
  async init(config: Record<string, string>) {
    logger.info('*** Initializing knowledge graph plugin ***');
    try {
      const validatedConfig = await configSchema.parseAsync(config);

      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) process.env[key] = value;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid plugin configuration: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      throw error;
    }
  },
  services: [KnowledgeGraphService],
  providers: [queryProvider],
};

export { KnowledgeGraphService };

export default plugin;
