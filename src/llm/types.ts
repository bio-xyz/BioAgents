export interface LLMProvider {
  name: 'openai' | 'google' | 'anthropic' | 'openrouter';
  apiKey: string;
  baseUrl?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: ChatMessage[];
  model: string;
  systemInstruction?: string;
  tools?: LLMTool[];
  thinkingBudget?: number;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  format?: any; // Optional format for structured output (e.g., zodTextFormat)
  fileUris?: Array<{ fileUri: string; mimeType: string }>; // For Gemini File API
}
// Coming soon: additional tool types
export type LLMToolType = 'webSearch' | 'codeExecution';
export interface LLMTool {
  type: LLMToolType;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface WebSearchResult {
  title: string;
  url: string;
  originalUrl: string;
  index: number;
}

export interface WebSearchResponse {
  cleanedLLMOutput: string;
  llmOutput: string;
  webSearchResults?: WebSearchResult[];
}
