/**
 * Serialized state-write helper for the deep-research orchestrator.
 *
 * Both the route and the worker currently maintain an ad-hoc promise chain
 * to serialize concurrent state writes during a single iteration — literature
 * + analysis tasks fan out in parallel and each may call back to persist task
 * output, and unserialized writes would clobber each other.
 *
 * createConversationStateWriteChain() returns a small object that linearises
 * those writes through a single Promise tail. Callers `.write()` whatever
 * state mutation they need and the chain awaits in order; the latest pending
 * tail can be awaited with `.flush()` before the iteration boundary.
 */

import type { ConversationStateValues } from "../../types/core";
import logger from "../../utils/logger";

export type ConversationStateWriteFn = (
  conversationStateId: string,
  nextValues: ConversationStateValues
) => Promise<void>;

export interface ConversationStateWriteChain {
  /**
   * Enqueue a state update. The update's `nextValues` are written after every
   * previously-queued write resolves. Returns a Promise that resolves once
   * THIS write lands; rejection isolation means a failing write logs but
   * never poisons subsequent writes.
   */
  write(conversationStateId: string, nextValues: ConversationStateValues): Promise<void>;
  /** Await all currently-queued writes. Call this before reading state back. */
  flush(): Promise<void>;
}

/**
 * Default write function for production callers — dynamically imports
 * updateConversationState. Dynamic import keeps the helper TDZ-safe in the
 * BullMQ worker process where db/operations eagerly initialises the supabase
 * client at module load.
 */
const defaultWrite: ConversationStateWriteFn = async (conversationStateId, nextValues) => {
  const { updateConversationState } = await import("../../db/operations");
  await updateConversationState(conversationStateId, nextValues);
};

export function createConversationStateWriteChain(
  write: ConversationStateWriteFn = defaultWrite
): ConversationStateWriteChain {
  let tail: Promise<unknown> = Promise.resolve();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = tail.then(task, task);
    // Keep the chain head moving even if individual writes throw.
    tail = next.catch(() => undefined);
    return next;
  };

  return {
    async flush(): Promise<void> {
      try {
        await tail;
      } catch {
        // Already logged in write()
      }
    },
    write(conversationStateId, nextValues): Promise<void> {
      return enqueue(async () => {
        try {
          await write(conversationStateId, nextValues);
        } catch (err) {
          logger.warn({ conversationStateId, err }, "deep_research_state_write_failed");
          throw err;
        }
      });
    },
  };
}
