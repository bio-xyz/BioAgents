/**
 * Custom hooks index
 * Central export point for all custom hooks
 */

export { useSessions } from './useSessions';
export { useChatAPI } from './useChatAPI';
export { useFileUpload } from './useFileUpload';
export { usePresignedUpload } from './usePresignedUpload';
export { useTypingAnimation } from './useTypingAnimation';
export { useAutoScroll } from './useAutoScroll';
export { useAutoResize } from './useAutoResize';
export { useAuth } from './useAuth';
export { useX402Payment } from './useX402Payment';
export { useToast } from './useToast';
export { useEmbeddedWallet } from './useEmbeddedWallet';
export { useEmbeddedWalletClient } from './useEmbeddedWalletClient';
export { useStates } from './useStates';
export { useWebSocket } from './useWebSocket';

export type { Message, Session, UseSessionsReturn } from './useSessions';
export type { UseWebSocketReturn, WebSocketMessage } from './useWebSocket';
export type { SendMessageParams, UseChatAPIReturn } from './useChatAPI';
export type { UseFileUploadReturn } from './useFileUpload';
export type { UsePresignedUploadReturn, UploadedFile } from './usePresignedUpload';
export type { UseTypingAnimationReturn } from './useTypingAnimation';
export type { UseAutoScrollReturn } from './useAutoScroll';
export type { UseX402PaymentReturn } from './useX402Payment';
export type { State, StateValues, ToolState, UseStatesReturn, ConversationState } from './useStates';
