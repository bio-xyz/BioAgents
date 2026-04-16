import {
  createConversation,
  createConversationState,
  createState,
  createUser,
  type DbConversationState,
  type DbState,
  getConversation,
  getConversationState,
  updateConversation,
} from "../../db/operations";
import logger from "../../utils/logger";

export interface SetupResult {
  success: boolean;
  error?: string;
}

export interface ConversationSetup {
  conversationStateRecord: DbConversationState & { id: string };
  stateRecord: DbState & { id: string };
}

/**
 * Ensures user and conversation exist with ownership validation
 * @param userId - The user's UUID
 * @param conversationId - The conversation UUID
 */
export async function ensureUserAndConversation(
  userId: string,
  conversationId: string
): Promise<SetupResult> {
  // Create user if not exists
  try {
    const user = await createUser({
      email: `${userId}@temp.local`,
      id: userId,
      username: `user_${userId.slice(0, 8)}`,
    });
    if (user) {
      if (logger) logger.info({ userId }, "user_created");
    } else {
      // User already exists (createUser returns null for duplicates)
      if (logger) logger.debug({ userId }, "user_already_exists");
    }
  } catch (err: unknown) {
    if (logger) logger.error({ err, userId }, "create_user_failed");
    return { error: "Failed to create user", success: false };
  }

  // Check if conversation exists and validate ownership
  try {
    const existingConversation = await getConversation(conversationId);

    if (existingConversation) {
      // Conversation exists - validate ownership
      if (existingConversation.user_id !== userId) {
        if (logger) {
          logger.warn(
            { conversationId, ownedBy: existingConversation.user_id, requestedBy: userId },
            "conversation_ownership_mismatch"
          );
        }
        return {
          error: "Access denied: conversation belongs to another user",
          success: false,
        };
      }
      // Ownership validated, conversation exists
      if (logger) {
        logger.info({ conversationId, userId }, "conversation_ownership_validated");
      }
      return { success: true };
    }
  } catch (_err: unknown) {
    // Conversation doesn't exist - that's fine, we'll create it
    if (logger) {
      logger.info({ conversationId }, "conversation_not_found_will_create");
    }
  }

  // Create new conversation
  try {
    await createConversation({
      id: conversationId,
      user_id: userId,
    });
    if (logger) logger.info({ conversationId, userId }, "conversation_created");
  } catch (err: unknown) {
    // Handle race condition: conversation was created between check and create.
    // Spreading an Error produces {} because message/code are often non-enumerable;
    // use an `in` check instead to reliably detect Supabase's 23505 unique-violation code.
    const errCode =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (errCode === "23505") {
      // Re-check ownership for the race condition case
      try {
        const racedConversation = await getConversation(conversationId);
        if (racedConversation && racedConversation.user_id !== userId) {
          return {
            error: "Access denied: conversation belongs to another user",
            success: false,
          };
        }
      } catch {
        // Ignore - original error takes precedence
      }
    } else {
      if (logger) {
        logger.error({ conversationId, err }, "create_conversation_failed");
      }
      return { error: "Failed to create conversation", success: false };
    }
  }

  return { success: true };
}

/**
 * Setup conversation state and message state
 */
export async function setupConversationData(
  conversationId: string,
  userId: string,
  source: string,
  isExternal: boolean,
  message: string,
  fileCount: number,
  agentId?: string
): Promise<{ success: boolean; data?: ConversationSetup; error?: string }> {
  let conversationStateRecord: DbConversationState & { id: string };
  let stateRecord: DbState & { id: string };

  // Get or create conversation state
  try {
    const conversation = await getConversation(conversationId);

    if (conversation.conversation_state_id) {
      conversationStateRecord = await getConversationState(conversation.conversation_state_id);
      if (logger) {
        logger.info(
          { conversationStateId: conversationStateRecord.id },
          "conversation_state_fetched"
        );
      }
    } else {
      conversationStateRecord = await createConversationState({
        values: {},
      });

      await updateConversation(conversationId, {
        conversation_state_id: conversationStateRecord.id,
      });

      if (logger) {
        logger.info(
          { conversationStateId: conversationStateRecord.id },
          "conversation_state_created"
        );
      }
    }
  } catch (err) {
    if (logger) {
      logger.error({ err }, "get_or_create_conversation_state_failed");
    }
    return {
      error: "Failed to get or create conversation state",
      success: false,
    };
  }

  // Create initial state in DB
  try {
    stateRecord = await createState({
      values: {
        conversationId,
        source,
        userId,
      },
    });
    if (logger) {
      logger.info({ stateId: stateRecord.id }, "state_created");
    }
  } catch (err) {
    if (logger) logger.error({ err }, "create_state_failed");
    return { error: "Failed to create state", success: false };
  }

  return {
    data: {
      conversationStateRecord,
      stateRecord,
    },
    success: true,
  };
}
