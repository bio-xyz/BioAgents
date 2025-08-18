import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

/**
 * Represents a table for storing internal knowledge database access for users.
 *
 * @type {Table}
 */
export const internalKnowledgeTable = pgTable(
  'internal_knowledge',
  {
    wallet: text('wallet').primaryKey().notNull(),
    hasInternalKnowledge: boolean('has_internal_knowledge').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => {
    return {
      walletUnique: unique('wallet_unique').on(table.wallet),
    };
  }
);
