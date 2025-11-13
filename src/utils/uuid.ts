import { randomUUID, createHash } from "crypto";

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
 * Converts a wallet address to a deterministic UUID v5
 * Same wallet address will always produce the same UUID
 *
 * Uses SHA-256 hash and formats it as a valid UUID v5
 *
 * @param walletAddress - The wallet address (e.g., 0x...)
 * @returns A deterministic UUID v5 string
 */
export function walletAddressToUUID(walletAddress: string): string {
  // Normalize the wallet address to lowercase
  const normalized = walletAddress.toLowerCase();

  // Create SHA-256 hash of the wallet address
  const hash = createHash('sha256').update(normalized).digest('hex');

  // Format as UUID v5: xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx
  // Take first 32 hex characters from hash
  const uuid = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '5' + hash.substring(13, 16), // UUID version 5
    ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.substring(18, 20), // Set variant bits
    hash.substring(20, 32)
  ].join('-');

  return uuid;
}