const LLM_PROVIDER_NAMES = ["openai", "google", "anthropic", "openrouter"] as const;
export type LLMProviderName = (typeof LLM_PROVIDER_NAMES)[number];

export function parseLLMProviderName(name: string): LLMProviderName {
  if ((LLM_PROVIDER_NAMES as readonly string[]).includes(name)) {
    return name as LLMProviderName;
  }
  throw new Error(`Invalid LLM provider: ${name}`);
}

export interface LLMProvider {
  name: LLMProviderName;
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
  effort?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  format?: unknown; // Optional format for structured output (e.g., zodTextFormat)
  fileUris?: Array<{ fileUri: string; mimeType: string }>; // For Gemini File API
  stream?: boolean; // Enable streaming responses
  onStreamChunk?: (chunk: string, fullText: string) => Promise<void>; // Callback for each chunk
  // Token usage tracking
  messageId?: string; // Message ID for chat/deep-research tracking
  paperId?: string; // Paper ID for paper-generation tracking
  usageType?: "chat" | "deep-research" | "paper-generation"; // Usage context type
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
  finishReason?: string; // "stop", "length", "max_tokens", etc. - varies by provider
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
