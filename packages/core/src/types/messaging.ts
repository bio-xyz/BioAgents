import type { Content, UUID } from './primitives';
import type { IAgentRuntime } from './runtime';

/**
 * Information describing the target of a message.
 */
export interface TargetInfo {
  source: string; // Platform identifier (e.g., 'discord', 'telegram', 'websocket-api')
  roomId?: UUID; // Target room ID (platform-specific or runtime-specific)
  channelId?: string; // Platform-specific channel/chat ID
  serverId?: string; // Platform-specific server/guild ID
  entityId?: UUID; // Target user ID (for DMs)
  threadId?: string; // Platform-specific thread ID (e.g., Telegram topics)
  // Add other relevant platform-specific identifiers as needed
}

/**
 * Function signature for handlers responsible for sending messages to specific platforms.
 */
export type SendHandlerFunction = (
  runtime: IAgentRuntime,
  target: TargetInfo,
  content: Content
) => Promise<void>;

export enum SOCKET_MESSAGE_TYPE {
  ROOM_JOINING = 1,
  SEND_MESSAGE = 2,
  MESSAGE = 3,
  ACK = 4,
  THINKING = 5,
  CONTROL = 6,
  MESSAGE_STATE = 7,
}

/**
 * Message processing states for real-time UI updates
 */
export enum MESSAGE_STATE {
  THINKING = 'THINKING',
  KNOWLEDGE = 'KNOWLEDGE',
  KNOWLEDGE_GRAPH = 'KNOWLEDGE-GRAPH',
  REPLYING = 'REPLYING',
  DONE = 'DONE',
}

/**
 * Interface for message state updates sent from backend to frontend
 * for real-time progress tracking during message processing
 */
export interface MessageStateUpdate {
  /** Message type identifier */
  type: 'messageState';

  /** Current processing state */
  state: MESSAGE_STATE;

  /** Room/Channel ID where the processing is happening */
  roomId: UUID;

  /** Optional message ID being processed */
  messageId?: UUID;

  /** Timestamp of state update */
  timestamp: number;
}

/**
 * Interface for control messages sent from the backend to the frontend
 * to manage UI state and interaction capabilities
 */
export interface ControlMessage {
  /** Message type identifier */
  type: 'control';

  /** Control message payload */
  payload: {
    /** Action to perform */
    action: 'disable_input' | 'enable_input';

    /** Optional target element identifier */
    target?: string;

    /** Additional optional parameters */
    [key: string]: unknown;
  };

  /** Room ID to ensure signal is directed to the correct chat window */
  roomId: UUID;
}
