import { describe, expect, test } from "bun:test";
import { generateUUID, walletAddressToUUID } from "../uuid";

describe("generateUUID", () => {
  test("returns valid UUID v4 format", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("generates unique values", () => {
    const a = generateUUID();
    const b = generateUUID();
    expect(a).not.toBe(b);
  });
});

describe("walletAddressToUUID", () => {
  test("returns valid UUID format", () => {
    const uuid = walletAddressToUUID("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("is deterministic — same input produces same output", () => {
    const addr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    expect(walletAddressToUUID(addr)).toBe(walletAddressToUUID(addr));
  });

  test("is case-insensitive", () => {
    const lower = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const mixed = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    expect(walletAddressToUUID(lower)).toBe(walletAddressToUUID(mixed));
  });

  test("different addresses produce different UUIDs", () => {
    const a = walletAddressToUUID("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    const b = walletAddressToUUID("0x0000000000000000000000000000000000000001");
    expect(a).not.toBe(b);
  });

  test("sets version 5 and variant bits correctly", () => {
    const uuid = walletAddressToUUID("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    const parts = uuid.split("-");
    // Version nibble (13th hex char) should be '5'
    expect(parts[2]![0]).toBe("5");
    // Variant nibble (17th hex char) should be 8, 9, a, or b
    expect(parts[3]![0]).toMatch(/[89ab]/);
  });
});
