import { z } from "zod";

export const MessageSchema = z.object({
  id: z.string().uuid().optional(),
  conversation_id: z.string().min(1),
  user_id: z.string().min(1),
  question: z.string(),
  content: z.string(),
  state: z.any().optional(),
  response_time: z.number().optional(),
  source: z.string().optional(),
  created_at: z.string().datetime().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

// State values interface for better type safety
export interface StateValues {
  // Request metadata
  messageId?: string;
  conversationId?: string;
  userId?: string;
  source?: string;

  // Cost tracking
  estimatedCostsUSD?: Record<string, number>;

  // File upload
  rawFiles?: Array<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    parsedText: string;
    metadata?: any;
  }>;
  fileUploadErrors?: string[];

  // OpenScholar provider
  openScholarPapers?: Array<{ title: string; doi: string }>;
  openScholarRaw?: Array<{ title: string; doi: string; chunkText: string }>;
  openScholarPaperDois?: string[];
  openScholarShortenedPapers?: string[];
  openScholarSynthesis?: string;

  // Semantic Scholar provider
  semanticScholarSynthesis?: string;
  semanticScholarPapers?: Paper[];

  // Knowledge provider
  knowledge?: Array<{ title: string; content: string }>;

  // Knowledge Graph provider
  kgPapers?: any[];
  finalPapers?: Paper[];

  // Hypothesis action
  hypothesis?: string;
  hypothesisThought?: string;

  // Action responses
  finalResponse?: string; // Final text response from REPLY or HYPOTHESIS
  webSearchResults?: Array<{
    title: string;
    url: string;
    originalUrl: string;
    index: number;
  }>;
  thought?: string;

  // Step tracking
  steps?: Record<string, { start: number; end?: number }>;
}

// Conversation state values interface (extends StateValues with persistent data)
export interface ConversationStateValues extends StateValues {
  // Persistent conversation data
  conversationTitle?: string; // Title of the conversation
  papers?: Paper[]; // All papers referenced in conversation
  conversationGoal?: string;
  keyInsights?: string[];
  methodology?: string;
}

// TODO: add expiry to state rows in DB
export const StateSchema = z.object({
  id: z.string().uuid().optional(),
  values: z.record(z.any()),
});

export type State = {
  id?: string;
  values: StateValues;
};

export type ConversationState = {
  id?: string;
  values: ConversationStateValues;
};

export type Tool = {
  name: string;
  description: string;
  execute: (input: {
    state: State;
    conversationState?: State;
    message: any;
    [key: string]: any;
  }) => Promise<any>;
  enabled?: boolean; // Tools are enabled by default
  deepResearchEnabled?: boolean; // Tools are enabled for deep research by default
  payment?: {
    required: boolean;
    priceUSD: string;
    tier: "free" | "basic" | "premium";
  };
};

export type LLMProvider = "google" | "openai" | "anthropic" | "openrouter";

export type Paper = {
  doi: string;
  title: string;
  chunkText?: string;
  abstract?: string;
};
