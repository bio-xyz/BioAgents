/**
 * Generates a unique conversation ID using Web Crypto API
 * Falls back to Math.random() for older browsers
 */
export function generateConversationId(): string {
  // Modern browsers support crypto.randomUUID()
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  // Fallback: Use crypto.getRandomValues for better randomness
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);

    // Set version (4) and variant bits
    array[6] = (array[6] & 0x0f) | 0x40;
    array[8] = (array[8] & 0x3f) | 0x80;

    // Convert to UUID format
    const hex = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last resort fallback for very old browsers (not cryptographically secure)
  console.warn('Using non-secure random UUID generation');
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
