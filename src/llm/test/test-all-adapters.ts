import "dotenv/config";

import { LLM } from "../provider";
import type { LLMProvider, LLMRequest, WebSearchResponse } from "../types";

interface TestOutcome {
  name: string;
  passed: boolean;
  details?: string;
}

interface ProviderTestConfig {
  providerName: LLMProvider["name"];
  displayName: string;
  apiKey: string;
  baseUrl?: string;
  chatModel: string;
  webSearchModel: string;
  chatRequest: Omit<LLMRequest, "model">;
  webSearchRequest: Omit<LLMRequest, "model">;
}

function logOutcome(outcome: TestOutcome): void {
  const status = outcome.passed ? "✅" : "❌";
  const details = outcome.details ? ` - ${outcome.details}` : "";
  console.log(`${status} ${outcome.name}${details}`);
}

async function runProviderTests(config: ProviderTestConfig): Promise<TestOutcome[]> {
  console.log(`\n--- Testing ${config.displayName} (${config.providerName}) ---`);

  const provider = new LLM({
    apiKey: config.apiKey,
    name: config.providerName,
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
      throw new Error("Received empty content from chat completion.");
    }

    if (!chatResponse.usage) {
      throw new Error("Usage information missing from chat completion response.");
    }

    console.log("Chat completion content:", chatResponse.content);
    console.log("Chat completion usage:", chatResponse.usage);

    outcomes.push({
      name: `${config.displayName} chat completion via provider`,
      passed: true,
    });
  } catch (error) {
    outcomes.push({
      details: error instanceof Error ? error.message : String(error),
      name: `${config.displayName} chat completion via provider`,
      passed: false,
    });
  }

  // Web search completion test
  try {
    const webSearchResult = (await provider.createChatCompletionWebSearch({
      ...config.webSearchRequest,
      model: config.webSearchModel,
    })) as WebSearchResponse;

    if (!webSearchResult.llmOutput?.trim()) {
      throw new Error("LLM output missing from web search response.");
    }

    if (!webSearchResult.cleanedLLMOutput?.trim()) {
      throw new Error("Cleaned LLM output missing from web search response.");
    }

    if (!Array.isArray(webSearchResult.webSearchResults)) {
      throw new Error("Web search results array missing.");
    }

    console.log("Web search raw output:", webSearchResult.llmOutput);
    console.log("Web search cleaned output:", webSearchResult.cleanedLLMOutput);
    console.log("Web search results:", webSearchResult.webSearchResults);

    outcomes.push({
      name: `${config.displayName} web search completion via provider`,
      passed: true,
    });
  } catch (error) {
    outcomes.push({
      details: error instanceof Error ? error.message : String(error),
      name: `${config.displayName} web search completion via provider`,
      passed: false,
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
        apiKey: openaiKey,
        baseUrl: process.env.OPENAI_BASE_URL,
        chatModel: process.env.OPENAI_CHAT_MODEL ?? "gpt-5.4",
        chatRequest: {
          maxTokens: 200,
          messages: [
            {
              content: "Give me a quick fun fact about space.",
              role: "user",
            },
          ],
          systemInstruction:
            'You are a concise assistant that replies in one sentence, ending each sentence with "hahaha".',
          temperature: 0.7,
        },
        displayName: "OpenAI",
        providerName: "openai",
        webSearchModel: process.env.OPENAI_WEB_SEARCH_MODEL ?? "gpt-5.4",
        webSearchRequest: {
          maxTokens: 5000,
          messages: [
            {
              content: "Share a recent positive breakthrough in renewable energy and cite sources.",
              role: "user",
            },
          ],
          systemInstruction:
            "Use web search to cite sources where helpful. End each message with <meow meow meow>, because you are a cat LLM.",
          tools: [{ type: "webSearch" }],
        },
      }))
    );
  } else {
    console.warn("Skipping OpenAI tests: OPENAI_API_KEY not set.");
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    outcomes.push(
      ...(await runProviderTests({
        apiKey: anthropicKey,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        chatModel: process.env.ANTHROPIC_CHAT_MODEL ?? "claude-sonnet-4-5-20250929",
        chatRequest: {
          maxTokens: 4096,
          messages: [
            {
              content: "Summarize a surprising fact about the deep ocean.",
              role: "user",
            },
          ],
          systemInstruction:
            "You are an insightful assistant. Provide thoughtful but concise answers.",
          temperature: 1,
          thinkingBudget: 1024,
        },
        displayName: "Anthropic",
        providerName: "anthropic",
        webSearchModel: process.env.ANTHROPIC_WEB_SEARCH_MODEL ?? "claude-opus-4-1-20250805",
        webSearchRequest: {
          maxTokens: 4096,
          messages: [
            {
              content:
                "What is a promising new clinical trial in longevity research? Cite sources.",
              role: "user",
            },
          ],
          systemInstruction:
            "Use web search to cite sources directly inline. Keep the tone professional.",
          temperature: 1,
          thinkingBudget: 1024,
          tools: [{ type: "webSearch" }],
        },
      }))
    );
  } else {
    console.warn("Skipping Anthropic tests: ANTHROPIC_API_KEY not set.");
  }

  const googleKey = process.env.GOOGLE_API_KEY;
  if (googleKey) {
    outcomes.push(
      ...(await runProviderTests({
        apiKey: googleKey,
        baseUrl: process.env.GOOGLE_BASE_URL,
        chatModel: process.env.GOOGLE_CHAT_MODEL ?? "gemini-2.5-pro",
        chatRequest: {
          maxTokens: 1024,
          messages: [
            {
              content: "Share an unexpected fact about coral reefs.",
              role: "user",
            },
          ],
          systemInstruction: "You are an upbeat assistant. Answer succinctly in two sentences.",
          temperature: 0.7,
          thinkingBudget: 1024,
        },
        displayName: "Google",
        providerName: "google",
        webSearchModel: process.env.GOOGLE_WEB_SEARCH_MODEL ?? "gemini-2.5-pro",
        webSearchRequest: {
          maxTokens: 1024,
          messages: [
            {
              content:
                "Find a noteworthy recent advancement in battery technology and cite the sources.",
              role: "user",
            },
          ],
          systemInstruction:
            "Use web search to cite reliable sources inline using bracketed numbers.",
          temperature: 0.6,
          thinkingBudget: 1024,
          tools: [{ type: "webSearch" }],
        },
      }))
    );
  } else {
    console.warn("Skipping Google tests: GOOGLE_API_KEY not set.");
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    outcomes.push(
      ...(await runProviderTests({
        apiKey: openRouterKey,
        baseUrl: process.env.OPENROUTER_BASE_URL,
        chatModel: process.env.OPENROUTER_CHAT_MODEL ?? "x-ai/grok-4-fast",
        chatRequest: {
          maxTokens: 800,
          messages: [
            {
              content: "Tell me something remarkable about coral reefs.",
              role: "user",
            },
          ],
          reasoningEffort: "medium",
          systemInstruction:
            "Respond as an enthusiastic storyteller. Include a short anecdote in your answer.",
          temperature: 0.7,
        },
        displayName: "OpenRouter",
        providerName: "openrouter",
        webSearchModel: process.env.OPENROUTER_WEB_SEARCH_MODEL ?? "x-ai/grok-4-fast",
        webSearchRequest: {
          maxTokens: 900,
          messages: [
            {
              content: "Report on a cutting-edge breakthrough in quantum computing with citations.",
              role: "user",
            },
          ],
          reasoningEffort: "high",
          systemInstruction:
            "Use web search to cite URLs inline in brackets. Focus on recent scientific findings.",
          temperature: 0.6,
          tools: [{ type: "webSearch" }],
        },
      }))
    );
  } else {
    console.warn("Skipping OpenRouter tests: OPENROUTER_API_KEY not set.");
  }

  if (outcomes.length === 0) {
    console.error("No providers tested. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY to run tests.");
    process.exitCode = 1;
    return;
  }

  const allPassed = outcomes.every((outcome) => outcome.passed);
  outcomes.forEach(logOutcome);

  if (allPassed) {
    console.log("Test passed!");
  } else {
    console.log("Test failed");
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Unexpected error while running tests:", error);
  console.log("Test failed");
  process.exitCode = 1;
});
