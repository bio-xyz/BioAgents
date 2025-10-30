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

// TODO: add expiry to state rows in DB
// TODO: add conversation state
export const StateSchema = z.object({
  id: z.string().uuid().optional(),
  values: z.record(z.any()),
});

export type State = z.infer<typeof StateSchema>;

export type Tool = {
  name: string;
  description: string;
  execute: (input: any) => Promise<any>;
  enabled?: boolean; // Tools are enabled by default
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
