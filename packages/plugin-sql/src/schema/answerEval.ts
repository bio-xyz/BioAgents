import { pgTable, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const answerEvalTable = pgTable('answer_eval', {
  id: text('id').primaryKey(), // UUID stored as text
  messageId: text('message_id'), // Reference to the memory this evaluation is for
  channelId: text('channel_id').notNull(), // Channel where this Q&A happened
  agentId: text('agent_id').notNull(), // Which agent provided the answer
  senderId: text('sender_id').notNull(), // Who asked the question
  question: text('question').notNull(), // The original question
  answer: text('answer'), // The agent's response
  knowledgeChunks: jsonb('knowledge_chunks').default(sql`'[]'::jsonb`), // Knowledge chunks used from knowledge provider
  knowledgeGraphChunks: jsonb('knowledge_graph_chunks').default(sql`'[]'::jsonb`), // Knowledge graph chunks if available
  knowledgeGraphSynthesis: text('knowledge_graph_synthesis'), // Knowledge graph synthesis if available
  responseTimeMs: integer('response_time_ms'), // Response time in milliseconds
  createdAt: timestamp('created_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export type AnswerEval = typeof answerEvalTable.$inferSelect;
export type NewAnswerEval = typeof answerEvalTable.$inferInsert;
