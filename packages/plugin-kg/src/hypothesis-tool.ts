import { IAgentRuntime, logger } from '@elizaos/core';
import { QueryStep, StepResult } from './constants/types';
import { HypothesesSchema } from './constants/schemas';
import { callOpenAIWithLangfuse } from './helpers';
import { openai } from './constants/constants';
import { KnowledgeGraphService } from './kg-service';

/**
 * Custom hypothesis tool with pre/post processing hooks
 * This allows for custom logic before and after LLM calls
 */
export class HypothesisTool {
  private static readonly TOOL_CONFIG = {
    name: 'HYPOTHESES_GENERATION',
    description:
      'Generate research hypotheses based on previous findings (should depend on all previous steps, if used)',
    template: `You are a research hypothesis generator. Based on the findings from previous analysis steps, generate testable research hypotheses.

## Original Research Question: {{ question }}

## Previous Step Results (if any):
{{ previous_results }}

## Task: Generate research hypotheses based on the patterns, connections, and gaps identified

## Requirements:
- Generate ONE specific, testable hypotheses
- Base hypotheses on evidence found in the analysis
- Focus on novel connections or unexplored relationships
- Make hypotheses specific enough to be experimentally testable
- Each hypothesis should be maximum 2 paragraphs - don't make them too long
- Cite relevant papers (their DOIs) provided in "previous step results", that you used for the hypotheses, if there are any.
- If there are no relevant papers in the previous step results, do not cite any - ITS CRUCIAL YOU DO NOT HALLUCINATE ANY PAPERS

## Analysis Summary:
The previous steps have identified key papers, concepts, authors, and connections. Use this information to formulate hypotheses that:
1. Build on established findings
2. Address identified research gaps
3. Propose novel mechanistic connections
4. Suggest therapeutic or diagnostic opportunities

Generate research hypotheses in this format:
{
  "hypothesis": "ONE specific, testable hypothesis statement with clear methodology (one sentence)",
  "rationale": "Brief explanation of why this hypothesis is worth testing based on the evidence (one sentence)",
  "supporting_papers": ["DOI1", "DOI2", "DOI3"], // Only include DOIs that were actually provided in previous_results. If there are no relevant papers in the previous step results, do not include any.
  "experimental_design": "Brief outline of how this could be tested (one sentence)",
  "keywords": ["keyword1", "keyword2", "keyword3"] // Keywords from the hypothesis
}

Generate research hypotheses based on the analysis`,
    response_model: { schema: HypothesesSchema, name: 'Hypotheses' },
    summarize: false,
    max_retries: 3,
  };

  /**
   * Pre-processing hook - executed before LLM call
   * Override this method to add custom logic before hypothesis generation
   */
  static async preProcess(
    step: QueryStep,
    contextData: Map<string, any>,
    question: string,
    _runtime?: IAgentRuntime
  ): Promise<{ step: QueryStep; contextData: Map<string, any>; question: string }> {
    // Empty for now - add custom logic here if needed
    return { step, contextData, question };
  }

  /**
   * Post-processing hook - executed after LLM call
   * Override this method to add custom logic after hypothesis generation
   */
  static async postProcess(
    result: StepResult,
    step: QueryStep,
    contextData: Map<string, any>,
    question: string,
    runtime: IAgentRuntime,
    hypothesisCreator: string
  ): Promise<StepResult> {
    try {
      // Generate the JSON-LD structure
      const randomId = crypto.randomUUID();
      const hypothesis = result.processed_output;

      // Extract data from context and previous steps
      const usedPapers = hypothesis.supporting_papers || [];
      const keywords = hypothesis.keywords || [];

      const jsonLD = {
        '@context': {
          dcterms: 'http://purl.org/dc/terms/',
          cito: 'http://purl.org/spar/cito/',
          deo: 'http://purl.org/spar/deo/',
        },
        '@id': `https://hypothesis.aubr.ai/${randomId}`,
        '@type': 'deo:FutureWork',
        'cito:usesDataFrom': usedPapers, // DOIs from supporting_papers
        'dcterms:references': [hypothesis.hypothesis], // The main hypothesis statement
        'dcterms:subject': keywords, // Keywords from question/context
        'dcterms:description': hypothesis.rationale,
        'deo:hasMethodology': hypothesis.experimental_design,
        'dcterms:creator': hypothesisCreator,
        'dcterms:created': new Date().toISOString(),
      };

      // Use the proper JSON-LD insertion method
      const kgService = runtime.getService('knowledge-graph') as KnowledgeGraphService;
      const success = await kgService.insertJsonLD(jsonLD, 'https://hypothesis.aubr.ai');

      if (success) {
        console.log(`✅ Successfully inserted hypothesis into knowledge graph`);
      } else {
        console.warn(`⚠️ Failed to insert hypothesis into knowledge graph`);
      }
    } catch (error) {
      console.error(`❌ Error in hypothesis post-processing:`, error);
      // Don't throw - we still want to return the result even if KG insertion fails
    }

    return result;
  }

  /**
   * Main execution method - handles the complete hypothesis generation workflow
   */
  static async execute(
    step: QueryStep,
    contextData: Map<string, any>,
    question: string,
    runtime: IAgentRuntime,
    hypothesisCreator: string
  ): Promise<StepResult> {
    try {
      // Pre-processing
      const {
        step: processedStep,
        contextData: processedContext,
        question: processedQuestion,
      } = await this.preProcess(step, contextData, question, runtime);

      // Core LLM execution
      const result = await this.executeLLMCall(
        processedStep,
        processedContext,
        processedQuestion,
        runtime
      );

      // Post-processing
      const finalResult = await this.postProcess(
        result,
        processedStep,
        processedContext,
        processedQuestion,
        runtime,
        hypothesisCreator
      );

      return finalResult;
    } catch (error) {
      logger.error('Error in hypothesis tool execution:', error);
      throw error;
    }
  }

  /**
   * Core LLM execution - the actual hypothesis generation
   */
  private static async executeLLMCall(
    step: QueryStep,
    contextData: Map<string, any>,
    question: string,
    runtime?: IAgentRuntime
  ): Promise<StepResult> {
    const toolConfig = this.TOOL_CONFIG;

    // Create prompt by replacing template placeholders
    let prompt = toolConfig.template;

    // Replace inputs in template
    prompt = prompt.replace('{{ question }}', question);

    // Dynamically replace all inputs from step.inputs
    for (const [key, value] of Object.entries(step.inputs)) {
      prompt = prompt.replace(`{{ ${key} }}`, JSON.stringify(value));
    }

    // Add previous results context (same as SPARQL service)
    const previousResults = Array.from(contextData.entries()).map(([key, value]) => ({
      [key]: typeof value === 'object' ? JSON.stringify(value).slice(0, 300) : value,
    }));
    prompt = prompt.replace('{{ previous_results }}', JSON.stringify(previousResults));

    console.log(`🤖 Executing hypothesis generation LLM call`);

    // Execute LLM prompt with Langfuse tracking
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a science research analysis expert. Return valid JSON responses when requested.',
      },
      { role: 'user' as const, content: prompt },
    ];

    let responseContent = '';
    if (runtime) {
      responseContent = await callOpenAIWithLangfuse(
        runtime,
        messages,
        process.env.KG_GENERATION_MODEL || 'gpt-4.1',
        0.3,
        1000,
        `kg-plugin-${step.type}`
      );
    } else {
      // Fallback to direct OpenAI call
      const llmResponse = await openai.chat.completions.create({
        model: process.env.KG_GENERATION_MODEL || 'gpt-4.1',
        messages,
        temperature: 0.3,
        max_tokens: 1000,
      });
      responseContent = llmResponse.choices[0]?.message?.content?.trim() || '';
    }

    let processedOutput;
    try {
      responseContent = responseContent.replace(/```json/g, '').replace(/```/g, '');
      const parsedResponse = JSON.parse(responseContent || '{}');
      processedOutput = toolConfig.response_model.schema.parse(parsedResponse);
    } catch (error) {
      processedOutput = {
        raw_response: responseContent,
        note: 'Could not parse as JSON',
      };
    }

    console.log(`✨ Hypothesis generation LLM call completed`);

    return {
      step: step.step,
      type: step.type,
      tool_used: 'HYPOTHESIS',
      prompt_used: prompt,
      query_or_response: responseContent || '',
      data: responseContent,
      processed_output: processedOutput,
    };
  }
}

// Export the tool configuration for use in prompts.ts
export const HYPOTHESIS_TOOL_CONFIG = HypothesisTool['TOOL_CONFIG'];
