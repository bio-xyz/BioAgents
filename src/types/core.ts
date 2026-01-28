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
  isDeepResearch?: boolean;

  // Action responses
  finalResponse?: string; // Final text response from REPLY or HYPOTHESIS
  thought?: string;

  // Step tracking
  steps?: Record<string, { start: number; end?: number }>;
}

export type PlanTask = {
  id?: string; // Format: "ana-1" or "lit-1" where 1 is the level number
  jobId?: string; // Actual job run id (edison id or bio id)
  objective: string;
  datasets: Array<{
    filename: string;
    id: string;
    description: string;
    path?: string;
  }>;
  type: "LITERATURE" | "ANALYSIS";
  level?: number;
  start?: string;
  end?: string;
  output?: string;
  artifacts?: Array<AnalysisArtifact>;
};

// Conversation state values interface (extends StateValues with persistent data)
export interface ConversationStateValues extends StateValues {
  // Persistent conversation data
  objective: string;
  conversationTitle?: string; // Concise title for the conversation (updated by reflection agent)
  currentObjective?: string;
  currentLevel?: number; // Current level of tasks being executed (for UI visualization)
  keyInsights?: string[];
  methodology?: string; // Methodology for the current goal
  currentHypothesis?: string;
  discoveries?: Discovery[]; // Structured scientific discoveries (only in deep research mode)
  plan?: Array<PlanTask>; // Actual plan being executed or already executed
  suggestedNextSteps?: Array<PlanTask>; // Suggestions for next iteration (from "next" planning mode)
  researchMode?: "semi-autonomous" | "fully-autonomous" | "steering"; // Research iteration mode (can change per request)
  uploadedDatasets?: Array<{
    filename: string;
    id: string;
    description: string;
    path?: string;
    content?: string; // Parsed text content (for PDFs, extracted text; for CSVs, preview rows)
    size?: number; // File size in bytes
  }>;
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
    conversationState?: ConversationState;
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

export type UploadedFile = {
  id: string;
  filename: string;
  mimeType?: string;
  path?: string;
  metadata?: any;
};

export type AnalysisArtifact = {
  id: string;
  description: string;
  type: "FILE" | "FOLDER";
  content?: string;
  name: string;
  path?: string;
};

export type DiscoveryEvidence = {
  taskId: string; // References PlanTask.id (e.g., "ana-1")
  jobId?: string; // Actual job ID (edison/bio job ID) for referencing the execution
  explanation: string; // Textual explanation of how this task supports the discovery
};

export type Discovery = {
  title: string; // Title of the discovery
  claim: string; // The main scientific claim
  summary: string; // Detailed summary of the discovery
  evidenceArray: DiscoveryEvidence[]; // Evidence from tasks supporting this discovery
  artifacts: AnalysisArtifact[]; // Relevant artifacts (e.g., figures, data files)
  novelty: string; // Explanation of novelty, can be empty if not assessed
};
