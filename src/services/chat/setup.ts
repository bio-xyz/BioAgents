import {
  createConversation,
  createConversationState,
  createState,
  createUser,
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
  conversationStateRecord: any;
  stateRecord: any;
}

/**
 * Ensures user and conversation exist with ownership validation
 * @param userId - The user's UUID
 * @param conversationId - The conversation UUID
 * @param options.skipUserCreation - Skip user creation (for x402 users who already exist)
 */
export async function ensureUserAndConversation(
  userId: string,
  conversationId: string,
  options?: { skipUserCreation?: boolean },
): Promise<SetupResult> {
  // Create user if not exists (skip for x402 users who are already created)
  if (!options?.skipUserCreation) {
    try {
      const user = await createUser({
        id: userId,
        username: `user_${userId.slice(0, 8)}`,
        email: `${userId}@temp.local`,
      });
      if (user) {
        if (logger) logger.info({ userId }, "user_created");
      } else {
        // User already exists (createUser returns null for duplicates)
        if (logger) logger.debug({ userId }, "user_already_exists");
      }
    } catch (err: any) {
      if (logger) logger.error({ err, userId }, "create_user_failed");
      return { success: false, error: "Failed to create user" };
    }
  } else {
    if (logger) logger.info({ userId }, "user_creation_skipped_x402");
  }

  // Check if conversation exists and validate ownership
  try {
    const existingConversation = await getConversation(conversationId);
    
    if (existingConversation) {
      // Conversation exists - validate ownership
      if (existingConversation.user_id !== userId) {
        if (logger) {
          logger.warn(
            { conversationId, requestedBy: userId, ownedBy: existingConversation.user_id },
            "conversation_ownership_mismatch"
          );
        }
        return { 
          success: false, 
          error: "Access denied: conversation belongs to another user" 
        };
      }
      // Ownership validated, conversation exists
      if (logger) {
        logger.info({ conversationId, userId }, "conversation_ownership_validated");
      }
      return { success: true };
    }
  } catch (err: any) {
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
  } catch (err: any) {
    // Handle race condition: conversation was created between check and create
    if (err.code === "23505") {
      // Re-check ownership for the race condition case
      try {
        const racedConversation = await getConversation(conversationId);
        if (racedConversation && racedConversation.user_id !== userId) {
          return { 
            success: false, 
            error: "Access denied: conversation belongs to another user" 
          };
        }
      } catch {
        // Ignore - original error takes precedence
      }
    } else {
      if (logger) {
        logger.error({ err, conversationId }, "create_conversation_failed");
      }
      return { success: false, error: "Failed to create conversation" };
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
  agentId?: string,
): Promise<{ success: boolean; data?: ConversationSetup; error?: string }> {
  let conversationStateRecord: any;
  let stateRecord: any;

  // Get or create conversation state
  try {
    const conversation = await getConversation(conversationId);

    if (conversation.conversation_state_id) {
      conversationStateRecord = await getConversationState(
        conversation.conversation_state_id,
      );
      if (logger) {
        logger.info(
          { conversationStateId: conversationStateRecord.id },
          "conversation_state_fetched",
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
          "conversation_state_created",
        );
      }
    }
  } catch (err) {
    if (logger) {
      logger.error({ err }, "get_or_create_conversation_state_failed");
    }
    return {
      success: false,
      error: "Failed to get or create conversation state",
    };
  }

  // Create initial state in DB
  try {
    stateRecord = await createState({
      values: {
        conversationId,
        userId,
        source,
      },
    });
    console.log('[setup] Created state with id:', stateRecord.id, 'for conversation:', conversationId, 'user:', userId);
    if (logger) {
      logger.info({ stateId: stateRecord.id }, "state_created");
    }
  } catch (err) {
    if (logger) logger.error({ err }, "create_state_failed");
    return { success: false, error: "Failed to create state" };
  }

  return {
    success: true,
    data: {
      conversationStateRecord,
      stateRecord,
    },
  };
}
