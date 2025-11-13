/**
 * Converts a wallet address to a deterministic UUID v5
 * Same wallet address will always produce the same UUID
 *
 * This must match the server-side implementation to ensure consistency
 * Uses Web Crypto API for SHA-256 hashing
 *
 * @param walletAddress - The wallet address (e.g., 0x...)
 * @returns Promise that resolves to a deterministic UUID v5 string
 */
export async function walletAddressToUUID(walletAddress: string): Promise<string> {
  // Normalize the wallet address to lowercase
  const normalized = walletAddress.toLowerCase();

  // Create SHA-256 hash of the wallet address using Web Crypto API
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert hash to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Format as UUID v5: xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx
  // Take first 32 hex characters from hash
  const uuid = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '5' + hash.substring(13, 16), // UUID version 5
    ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hash.substring(18, 20), // Set variant bits
    hash.substring(20, 32)
  ].join('-');

  return uuid;
}
