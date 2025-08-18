import { StepResult } from './constants/types';
import { openai } from './constants/constants';
import { IAgentRuntime, logger } from '@elizaos/core';
import { v4 } from 'uuid';

/**
 * Call OpenAI and track to Langfuse
 */
export async function callOpenAIWithLangfuse(
  runtime: IAgentRuntime,
  messages: any[],
  model: string = 'gpt-4.1',
  temperature: number = 0.3,
  max_tokens: number = 1000,
  component: string = 'kg-plugin'
): Promise<string> {
  // Get Langfuse service if available
  const langfuseService = runtime.getService('langfuse');
  let trace: any = null;
  let generation: any = null;

  if (langfuseService) {
    const traceId = v4();
    const sessionId = 'kg-plugin-session';

    logger.debug(`[KG-Plugin] Creating Langfuse trace for ${model}`);

    // Create trace
    trace = (langfuseService as any).langfuse?.trace({
      id: traceId,
      name: model,
      sessionId,
      tags: ['eliza-agent', 'kg-plugin', 'openai', model],
      metadata: {
        modelType: 'TEXT_LARGE',
        actualModelName: model,
        provider: 'openai',
        component,
        temperature,
        max_tokens,
      },
    });

    // Create generation
    generation = trace?.generation({
      name: `${model}-generation`,
      model: model,
      modelParameters: {
        temperature,
        max_tokens,
      },
      input: messages,
    });

    logger.debug(`[KG-Plugin] Langfuse trace created with ID: ${traceId}`);
  } else {
    logger.debug(`[KG-Plugin] No Langfuse service available, skipping trace`);
  }

  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens,
    });

    const result = response.choices[0]?.message?.content?.trim() || '';

    // Finalize Langfuse tracking
    if (generation) {
      logger.debug(
        `[KG-Plugin] Finalizing Langfuse trace with ${response.usage?.prompt_tokens || 0} input tokens and ${response.usage?.completion_tokens || 0} output tokens`
      );

      generation.end({
        output: {
          role: 'assistant',
          content: result,
        },
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        metadata: {
          finish_reason: response.choices[0]?.finish_reason,
          model: response.model,
          raw_response: {
            id: response.id,
            object: response.object,
            created: response.created,
            usage: response.usage,
          },
        },
      });

      logger.debug(`[KG-Plugin] Langfuse trace finalized successfully`);
    }

    // Add cost tracking if available
    if (langfuseService && response.usage) {
      const cost =
        response.usage.prompt_tokens * 0.0000015 + response.usage.completion_tokens * 0.000002;
      (langfuseService as any).totalCosts = ((langfuseService as any).totalCosts || 0) + cost;
    }

    return result;
  } catch (error) {
    if (generation) {
      generation.end({
        output: {
          role: 'assistant',
          content: null,
        },
        statusMessage: error instanceof Error ? error.message : 'Unknown error',
        level: 'ERROR',
        metadata: {
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  stack: error.stack,
                  name: error.name,
                }
              : String(error),
        },
      });
    }
    throw error;
  }
}

export async function generateFinalSynthesis(
  question: string,
  results: StepResult[],
  runtime?: IAgentRuntime
): Promise<string> {
  const synthesisPrompt = `You are a leading scientist in your field, reviewing research findings to answer an important scientific question. Based on the evidence and analysis below, provide a natural, scientific response.
    
  Research Question: ${question}

  Evidence:
  The following results from scientific papers have been pre-selected as relevant evidence for the research question.
  You MUST consider them as evidence for the posed question:
  ${results.map((r) => `${JSON.stringify(r.processed_output, null, 2)}`).join('\n\n')}
  
  Please provide a comprehensive scientific response that:
  - The evidence above is a list of papers that were collected based on the research question.
  - Directly answers the research question in a natural way
  - Synthesizes the key findings and evidence from the literature
  - Discusses the strength and limitations of current evidence
  - Suggests promising directions for future investigation
  - Cite relevant papers and findings to support your points
  
  Keep your response focused and concise (2-3 paragraphs maximum). The evidence is directly related to the research question, so you should be able to answer the question based on the evidence.
  If the evidence is not connected to the question, or if there's no evidence, simply state "No information found in the Knowledge Graph."

  CRITICAL: You MUST answer the question based on the evidence above - do not base it upon your own knowledge or what you think the answer should be.
  CRITICAL: Only cite papers that appear in the evidence above - do not reference any other studies.`;

  const messages = [
    {
      role: 'system' as const,
      content:
        'You are a leading scientist providing expert analysis and synthesis of research findings. Write natural, evidence-based responses that draw on your scientific expertise.',
    },
    { role: 'user' as const, content: synthesisPrompt },
  ];

  let responseContent = '';
  if (runtime) {
    responseContent = await callOpenAIWithLangfuse(
      runtime,
      messages,
      process.env.KG_GENERATION_MODEL || 'gpt-4.1',
      0.3,
      1500,
      'kg-plugin-synthesis'
    );
  } else {
    // Fallback to direct OpenAI call
    const response = await openai.chat.completions.create({
      model: process.env.KG_GENERATION_MODEL || 'gpt-4.1',
      messages,
      temperature: 0.3,
      max_tokens: 1500,
    });
    responseContent = response.choices[0]?.message?.content?.trim() || '';
  }

  return responseContent || 'Multi-step analysis completed successfully.';
}

export function getTwitterHandleFromEntities(entitiesString: string) {
  const secondUserLine = entitiesString.split('\n').filter((line) => line.includes('aka'))[1];

  if (!secondUserLine) return null;

  // Get ALL aka matches and take the last one
  const akaMatches = [...secondUserLine.matchAll(/aka "([^"]+)"/g)];
  return akaMatches[akaMatches.length - 1]?.[1];
}
