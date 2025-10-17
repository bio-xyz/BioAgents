import 'dotenv/config';

import { LLM } from '../provider';
import type { LLMProvider, LLMRequest, WebSearchResponse } from '../types';

interface TestOutcome {
  name: string;
  passed: boolean;
  details?: string;
}

interface ProviderTestConfig {
  providerName: LLMProvider['name'];
  displayName: string;
  apiKey: string;
  baseUrl?: string;
  chatModel: string;
  webSearchModel: string;
  chatRequest: Omit<LLMRequest, 'model'>;
  webSearchRequest: Omit<LLMRequest, 'model'>;
}

function logOutcome(outcome: TestOutcome): void {
  const status = outcome.passed ? '✅' : '❌';
  const details = outcome.details ? ` - ${outcome.details}` : '';
  console.log(`${status} ${outcome.name}${details}`);
}

async function runProviderTests(config: ProviderTestConfig): Promise<TestOutcome[]> {
  console.log(`\n--- Testing ${config.displayName} (${config.providerName}) ---`);

  const provider = new LLM({
    name: config.providerName,
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  });

  const outcomes: TestOutcome[] = [];

  // Chat completion test
  try {
    const chatResponse = await provider.createChatCompletion({
      ...config.chatRequest,
      model: config.chatModel,
    });

    if (!chatResponse.content?.trim()) {
      throw new Error('Received empty content from chat completion.');
    }

    if (!chatResponse.usage) {
      throw new Error('Usage information missing from chat completion response.');
    }

    console.log('Chat completion content:', chatResponse.content);
    console.log('Chat completion usage:', chatResponse.usage);

    outcomes.push({
      name: `${config.displayName} chat completion via provider`,
      passed: true,
    });
  } catch (error) {
    outcomes.push({
      name: `${config.displayName} chat completion via provider`,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  // Web search completion test
  try {
    const webSearchResult = (await provider.createChatCompletionWebSearch({
      ...config.webSearchRequest,
      model: config.webSearchModel,
    })) as WebSearchResponse;

    if (!webSearchResult.llmOutput?.trim()) {
      throw new Error('LLM output missing from web search response.');
    }

    if (!webSearchResult.cleanedLLMOutput?.trim()) {
      throw new Error('Cleaned LLM output missing from web search response.');
    }

    if (!Array.isArray(webSearchResult.webSearchResults)) {
      throw new Error('Web search results array missing.');
    }

    console.log('Web search raw output:', webSearchResult.llmOutput);
    console.log('Web search cleaned output:', webSearchResult.cleanedLLMOutput);
    console.log('Web search results:', webSearchResult.webSearchResults);

    outcomes.push({
      name: `${config.displayName} web search completion via provider`,
      passed: true,
    });
  } catch (error) {
    outcomes.push({
      name: `${config.displayName} web search completion via provider`,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  return outcomes;
}

async function run(): Promise<void> {
  const outcomes: TestOutcome[] = [];

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    outcomes.push(
      ...(await runProviderTests({
        providerName: 'openai',
        displayName: 'OpenAI',
        apiKey: openaiKey,
        baseUrl: process.env.OPENAI_BASE_URL,
        chatModel: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
        webSearchModel: process.env.OPENAI_WEB_SEARCH_MODEL ?? 'gpt-5',
        chatRequest: {
          systemInstruction:
            'You are a concise assistant that replies in one sentence, ending each sentence with "hahaha".',
          messages: [
            {
              role: 'user',
              content: 'Give me a quick fun fact about space.',
            },
          ],
          temperature: 0.7,
          maxTokens: 200,
        },
        webSearchRequest: {
          systemInstruction:
            'Use web search to cite sources where helpful. End each message with <meow meow meow>, because you are a cat LLM.',
          messages: [
            {
              role: 'user',
              content: 'Share a recent positive breakthrough in renewable energy and cite sources.',
            },
          ],
          maxTokens: 5000,
          tools: [{ type: 'webSearch' }],
        },
      }))
    );
  } else {
    console.warn('Skipping OpenAI tests: OPENAI_API_KEY not set.');
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    outcomes.push(
      ...(await runProviderTests({
        providerName: 'anthropic',
        displayName: 'Anthropic',
        apiKey: anthropicKey,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        chatModel: process.env.ANTHROPIC_CHAT_MODEL ?? 'claude-sonnet-4-5-20250929',
        webSearchModel: process.env.ANTHROPIC_WEB_SEARCH_MODEL ?? 'claude-opus-4-1-20250805',
        chatRequest: {
          systemInstruction:
            'You are an insightful assistant. Provide thoughtful but concise answers.',
          messages: [
            {
              role: 'user',
              content: 'Summarize a surprising fact about the deep ocean.',
            },
          ],
          maxTokens: 4096,
          thinkingBudget: 1024,
          temperature: 1,
        },
        webSearchRequest: {
          systemInstruction:
            'Use web search to cite sources directly inline. Keep the tone professional.',
          messages: [
            {
              role: 'user',
              content:
                'What is a promising new clinical trial in longevity research? Cite sources.',
            },
          ],
          maxTokens: 4096,
          thinkingBudget: 1024,
          temperature: 1,
          tools: [{ type: 'webSearch' }],
        },
      }))
    );
  } else {
    console.warn('Skipping Anthropic tests: ANTHROPIC_API_KEY not set.');
  }

  const googleKey = process.env.GOOGLE_API_KEY;
  if (googleKey) {
    outcomes.push(
      ...(await runProviderTests({
        providerName: 'google',
        displayName: 'Google',
        apiKey: googleKey,
        baseUrl: process.env.GOOGLE_BASE_URL,
        chatModel: process.env.GOOGLE_CHAT_MODEL ?? 'gemini-2.5-pro',
        webSearchModel: process.env.GOOGLE_WEB_SEARCH_MODEL ?? 'gemini-2.5-pro',
        chatRequest: {
          systemInstruction: 'You are an upbeat assistant. Answer succinctly in two sentences.',
          messages: [
            {
              role: 'user',
              content: 'Share an unexpected fact about coral reefs.',
            },
          ],
          temperature: 0.7,
          maxTokens: 1024,
          thinkingBudget: 1024,
        },
        webSearchRequest: {
          systemInstruction:
            'Use web search to cite reliable sources inline using bracketed numbers.',
          messages: [
            {
              role: 'user',
              content:
                'Find a noteworthy recent advancement in battery technology and cite the sources.',
            },
          ],
          maxTokens: 1024,
          temperature: 0.6,
          thinkingBudget: 1024,
          tools: [{ type: 'webSearch' }],
        },
      }))
    );
  } else {
    console.warn('Skipping Google tests: GOOGLE_API_KEY not set.');
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    outcomes.push(
      ...(await runProviderTests({
        providerName: 'openrouter',
        displayName: 'OpenRouter',
        apiKey: openRouterKey,
        baseUrl: process.env.OPENROUTER_BASE_URL,
        chatModel: process.env.OPENROUTER_CHAT_MODEL ?? 'x-ai/grok-4-fast',
        webSearchModel: process.env.OPENROUTER_WEB_SEARCH_MODEL ?? 'x-ai/grok-4-fast',
        chatRequest: {
          systemInstruction:
            'Respond as an enthusiastic storyteller. Include a short anecdote in your answer.',
          messages: [
            {
              role: 'user',
              content: 'Tell me something remarkable about coral reefs.',
            },
          ],
          maxTokens: 800,
          temperature: 0.7,
          reasoningEffort: 'medium',
        },
        webSearchRequest: {
          systemInstruction:
            'Use web search to cite URLs inline in brackets. Focus on recent scientific findings.',
          messages: [
            {
              role: 'user',
              content: 'Report on a cutting-edge breakthrough in quantum computing with citations.',
            },
          ],
          maxTokens: 900,
          temperature: 0.6,
          reasoningEffort: 'high',
          tools: [{ type: 'webSearch' }],
        },
      }))
    );
  } else {
    console.warn('Skipping OpenRouter tests: OPENROUTER_API_KEY not set.');
  }

  if (outcomes.length === 0) {
    console.error('No providers tested. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY to run tests.');
    process.exitCode = 1;
    return;
  }

  const allPassed = outcomes.every((outcome) => outcome.passed);
  outcomes.forEach(logOutcome);

  if (allPassed) {
    console.log('Test passed!');
  } else {
    console.log('Test failed');
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('Unexpected error while running tests:', error);
  console.log('Test failed');
  process.exitCode = 1;
});
