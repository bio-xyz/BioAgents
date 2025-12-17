/**
 * Converts a wallet address (0x...) to a deterministic UUID.
 * Uses SHA-256 hash of the wallet address to create a namespace-based UUID (v5-like).
 * Same wallet address will always produce the same UUID.
 */
export async function walletAddressToUUIDAsync(walletAddress: string): Promise<string> {
  // Normalize wallet address
  const normalized = walletAddress.toLowerCase();

  // Hash the wallet address using SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);

  // Take first 16 bytes and format as UUID v5 style
  const uuid = hashArray.slice(0, 16);

  // Set version (5) and variant bits for namespace-based UUID
  uuid[6] = (uuid[6] & 0x0f) | 0x50; // Version 5
  uuid[8] = (uuid[8] & 0x3f) | 0x80; // Variant

  // Convert to UUID format
  const hex = Array.from(uuid, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Synchronous version of walletAddressToUUID using a simple hash.
 * Uses djb2 hash algorithm for deterministic UUID generation.
 * Same wallet address will always produce the same UUID.
 */
export function walletAddressToUUID(walletAddress: string): string {
  // Normalize wallet address
  const normalized = walletAddress.toLowerCase();

  // Simple hash function (djb2 variant)
  function hash(str: string): number[] {
    const result: number[] = [];
    let h1 = 5381;
    let h2 = 52711;
    let h3 = 31337;
    let h4 = 7919;

    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = ((h1 << 5) + h1) ^ c;
      h2 = ((h2 << 5) + h2) ^ c;
      h3 = ((h3 << 5) + h3) ^ c;
      h4 = ((h4 << 5) + h4) ^ c;
    }

    // Convert to bytes (big endian)
    for (const h of [h1, h2, h3, h4]) {
      result.push((h >>> 24) & 0xff);
      result.push((h >>> 16) & 0xff);
      result.push((h >>> 8) & 0xff);
      result.push(h & 0xff);
    }

    return result;
  }

  const hashBytes = hash(normalized);

  // Set version (5) and variant bits
  hashBytes[6] = (hashBytes[6] & 0x0f) | 0x50; // Version 5
  hashBytes[8] = (hashBytes[8] & 0x3f) | 0x80; // Variant

  // Convert to UUID format
  const hex = hashBytes.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
