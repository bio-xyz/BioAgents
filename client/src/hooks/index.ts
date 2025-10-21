/**
 * Custom hooks index
 * Central export point for all custom hooks
 */

export { useSessions } from './useSessions';
export { useChatAPI } from './useChatAPI';
export { useFileUpload } from './useFileUpload';
export { useTypingAnimation } from './useTypingAnimation';
export { useAutoScroll } from './useAutoScroll';
export { useAutoResize } from './useAutoResize';

export type { Message, Session, UseSessionsReturn } from './useSessions';
export type { SendMessageParams, UseChatAPIReturn } from './useChatAPI';
export type { UseFileUploadReturn } from './useFileUpload';
export type { UseTypingAnimationReturn } from './useTypingAnimation';
export type { UseAutoScrollReturn } from './useAutoScroll';
