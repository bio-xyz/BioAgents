export function generateConversationId() {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
