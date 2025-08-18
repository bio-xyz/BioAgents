import { IAgentRuntime, Service } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { KG_TRIPLE_STORE_URL, openai } from './constants/constants';
import { QueryStep, SparqlResponse, StepResult } from './constants/types';
import { SPARQL_TOOLS } from './constants/prompts';
import { callOpenAIWithLangfuse } from './helpers';
import { HypothesisTool } from './hypothesis-tool';
// @ts-ignore
import { Store, Quad } from 'n3';
import { JsonLdParser } from 'jsonld-streaming-parser';

class SparqlError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'SparqlError';
  }
}

export class KnowledgeGraphService extends Service {
  static serviceType = 'knowledge-graph';
  capabilityDescription = 'Service for managing knowledge graph connections and queries';
  private tripleStoreUrl: string;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.tripleStoreUrl = KG_TRIPLE_STORE_URL;
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('*** Starting knowledge graph service ***');
    const service = new KnowledgeGraphService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** Stopping knowledge graph service ***');
    const service = runtime.getService(KnowledgeGraphService.serviceType);
    if (!service) {
      throw new Error('Knowledge graph service not found');
    }
    service.stop();
  }

  async stop() {
    logger.info('*** Stopping knowledge graph service instance ***');
  }

  async sparqlRequest(query: string): Promise<SparqlResponse> {
    try {
      const response = await fetch(this.tripleStoreUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-query',
          Accept: 'application/sparql-results+json',
        },
        body: query, // Send raw query string, not JSON
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data as SparqlResponse;
    } catch (error) {
      if (error instanceof Error) {
        throw new SparqlError(`SPARQL request failed: ${error.message}`, error);
      }
      throw new SparqlError('Unknown SPARQL error occurred');
    }
  }

  async executeSparqlStep(
    step: QueryStep,
    contextData: Map<string, any>,
    question: string,
    runtime?: IAgentRuntime
  ): Promise<StepResult> {
    const toolConfig = SPARQL_TOOLS[step.type];

    // Create prompt by replacing template placeholders
    let prompt = toolConfig.template;

    // Replace inputs in template
    prompt = prompt.replace('{{ question }}', question);

    // Dynamically replace all inputs from step.inputs
    for (const [key, value] of Object.entries(step.inputs)) {
      prompt = prompt.replace(`{{ ${key} }}`, JSON.stringify(value));
    }

    // Add previous results context
    const previousResults = Array.from(contextData.entries()).map(([key, value]) => ({
      [key]: typeof value === 'object' ? JSON.stringify(value) : value,
    }));
    prompt = prompt.replace('{{ previous_results }}', JSON.stringify(previousResults));

    console.log(`📝 Generating SPARQL query for ${step.type}`);

    // Generate SPARQL query using LLM with Langfuse tracking
    const messages = [
      {
        role: 'system' as const,
        content: 'Generate optimized SPARQL queries. Return only valid SPARQL syntax.',
      },
      { role: 'user' as const, content: prompt },
    ];

    let sparqlQuery = '';
    if (runtime) {
      sparqlQuery = await callOpenAIWithLangfuse(
        runtime,
        messages,
        process.env.KG_GENERATION_MODEL || 'gpt-4.1',
        0.1,
        1500,
        `kg-service-${step.type}-query`
      );
    } else {
      // Fallback to direct OpenAI call
      const queryResponse = await openai.chat.completions.create({
        model: process.env.KG_GENERATION_MODEL || 'gpt-4.1',
        messages,
        temperature: 0.1,
        max_tokens: 1500,
      });
      sparqlQuery = queryResponse.choices[0]?.message?.content?.trim() || '';
    }

    // Clean up query
    if (sparqlQuery?.startsWith('```sparql')) {
      sparqlQuery = sparqlQuery.slice(9, -3);
    } else if (sparqlQuery?.startsWith('```')) {
      sparqlQuery = sparqlQuery.slice(3, -3);
    }

    console.log(`🗄️ Executing SPARQL query`);
    console.log(sparqlQuery);

    // Execute SPARQL query
    const queryData = await this.sparqlRequest(sparqlQuery);

    let processedOutput: any;

    if (toolConfig.summarize) {
      // Generate summary using LLM
      const summaryPrompt = `Summarize the following research papers. For each paper, include its DOI (from the paper URI), title, and a brief summary of its key findings or contributions:
    
    ${JSON.stringify((queryData as any).results.bindings, null, 2)}
    
    Format your response as a JSON object with this structure:
    {
      "papers": [
        {
          "doi": "paper's DOI",
          "title": "paper's title",
          "summary": "brief summary of key findings"
        }
      ],
      "count": number of papers,
      "overview": "brief overview of all papers collectively"
    }`;

      const summaryMessages = [
        {
          role: 'system' as const,
          content:
            'You are a research paper summarizer. Provide clear, concise summaries focusing on key findings and contributions.',
        },
        { role: 'user' as const, content: summaryPrompt },
      ];

      let summaryResponseContent = '';
      if (runtime) {
        summaryResponseContent = await callOpenAIWithLangfuse(
          runtime,
          summaryMessages,
          process.env.KG_GENERATION_MODEL || 'gpt-4.1',
          0.1,
          1500,
          `kg-service-${step.type}-summary`
        );
      } else {
        // Fallback to direct OpenAI call
        const summaryResponse = await openai.chat.completions.create({
          model: process.env.KG_GENERATION_MODEL || 'gpt-4.1',
          messages: summaryMessages,
          temperature: 0.1,
          max_tokens: 1500,
        });
        summaryResponseContent = summaryResponse.choices[0]?.message?.content?.trim() || '';
      }

      try {
        const parsedResponse = JSON.parse(
          summaryResponseContent
            ?.trim()
            .replace(/```json/g, '')
            .replace(/```/g, '') || '{}'
        );
        processedOutput = toolConfig.response_model.schema.parse(parsedResponse);
      } catch (error) {
        processedOutput = {
          papers: queryData.results.bindings,
          count: queryData.results.bindings.length,
          overview: 'Failed to parse summary response',
        };
      }
    } else {
      // For non-summarized results, just parse the raw data
      try {
        processedOutput = queryData.results.bindings[0];
      } catch (error) {
        processedOutput = queryData.results.bindings[0];
      }
    }

    return {
      step: step.step,
      type: step.type,
      tool_used: 'SPARQL',
      prompt_used: prompt,
      query_or_response: sparqlQuery,
      data: queryData,
      processed_output: processedOutput,
      paper_count: toolConfig.summarize ? processedOutput.count : queryData.results.bindings.length,
    };
  }

  async executeHypothesisStep(
    step: QueryStep,
    contextData: Map<string, any>,
    question: string,
    runtime: IAgentRuntime,
    hypothesisCreator: string
  ): Promise<StepResult> {
    console.log(`🧬 Executing custom hypothesis step: ${step.type}`);

    // Use the custom HypothesisTool which includes pre/post processing
    const result = await HypothesisTool.execute(
      step,
      contextData,
      question,
      runtime,
      hypothesisCreator
    );

    console.log(`✅ Custom hypothesis step ${step.type} completed`);
    return result;
  }

  /**
   * Insert JSON-LD data into the knowledge graph using the same logic as load-kg.ts
   * Uses JsonLdParser and N3 Store to properly parse and convert to N-Quads
   */
  async insertJsonLD(jsonLD: any, graphId: string): Promise<boolean> {
    try {
      console.log(`📝 Inserting JSON-LD into graph: ${graphId}`);

      // Convert JSON-LD object to string
      const jsonLdString = JSON.stringify(jsonLD);

      // Use the same logic as load-kg.ts
      const store = new Store();
      const parser = new JsonLdParser();

      return new Promise((resolve, reject) => {
        parser.on('data', (quad: Quad) => {
          store.addQuad(quad);
        });

        parser.on('error', (error) => {
          console.error(`JSON-LD parsing error:`, error);
          reject(error);
        });

        parser.on('end', async () => {
          console.log(`📊 Parsed ${store.size} quads from JSON-LD`);

          // Convert to N-Quads format (same as load-kg.ts)
          const nquads = store
            .getQuads(null, null, null, null)
            .map(
              (quad: Quad) =>
                `<${quad.subject.value}> <${quad.predicate.value}> ${
                  quad.object.termType === 'Literal'
                    ? `"${quad.object.value.replace(/"/g, '\\"')}"`
                    : `<${quad.object.value}>`
                } <${graphId}>.`
            )
            .join('\n');

          try {
            // Use the /store endpoint (same as load-kg.ts)
            const storeUrl = this.tripleStoreUrl.replace('/query', '/store');
            console.log(`🗄️ Inserting N-Quads to: ${storeUrl}`);

            const response = await fetch(storeUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/n-quads',
              },
              body: nquads,
            });

            if (response.status === 204) {
              console.log(`✅ Successfully stored JSON-LD in graph: ${graphId}`);
              resolve(true);
            } else {
              console.error(`❌ Failed to store JSON-LD. Status: ${response.status}`);
              resolve(false);
            }
          } catch (error) {
            console.error(`❌ Error storing JSON-LD in Oxigraph:`, error);
            reject(error);
          }
        });

        // Parse the JSON-LD string
        parser.write(jsonLdString);
        parser.end();
      });
    } catch (error) {
      console.error(`❌ Error inserting JSON-LD:`, error);
      throw new SparqlError(
        `Failed to insert JSON-LD: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
