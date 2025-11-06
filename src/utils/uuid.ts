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