import { randomUUID } from "crypto";

/**
 * Generates a UUID v4 (RFC 4122 compliant)
 * Uses Node.js crypto.randomUUID() for cryptographic randomness
 *
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * Example: "550e8400-e29b-41d4-a716-446655440000"
 *
 * @returns A cryptographically secure UUID v4 string
 */
export function generateUUID(): string {
  return randomUUID();
}

/**
 * Converts a wallet address (0x...) to a deterministic UUID.
 * Uses djb2 hash algorithm matching the client-side implementation.
 * Same wallet address will always produce the same UUID.
 *
 * IMPORTANT: This must match the client-side implementation in client/src/utils/helpers.ts
 *
 * @param walletAddress - Ethereum wallet address (0x...)
 * @returns Deterministic UUID v5-style string
 */
export function walletAddressToUUID(walletAddress: string): string {
  // Normalize wallet address
  const normalized = walletAddress.toLowerCase();

  // Simple hash function (djb2 variant) - must match client implementation
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

  const hashBytes: any = hash(normalized);

  // Set version (5) and variant bits
  hashBytes[6] = (hashBytes[6] & 0x0f) | 0x50; // Version 5
  hashBytes[8] = (hashBytes[8] & 0x3f) | 0x80; // Variant

  // Convert to UUID format
  const hex = hashBytes.map((b: any) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}