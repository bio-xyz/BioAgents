import { z } from "zod";

export const MessageSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(), // ISO 8601
  conversationId: z.string().min(1),
  source: z.string().optional(),
  content: z.object({
    thought: z.string().optional(),
    text: z.string().optional(),
    actions: z.array(z.string()).optional(),
    providers: z.array(z.string()).optional(),
  }),
});

export type Message = z.infer<typeof MessageSchema>;

export const StateSchema = z.object({
  values: z.record(z.any()),
});

export type State = z.infer<typeof StateSchema>;

export type Tool = {
  name: string;
  description: string;
  execute: (input: any) => Promise<any>;
};

export type LLMProvider = "google" | "openai" | "anthropic" | "openrouter";

export type Paper = {
  doi: string;
  title: string;
  chunkText?: string;
  abstract?: string;
};
