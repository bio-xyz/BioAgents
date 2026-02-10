import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import * as jose from "jose";
import {
  generatePollToken,
  verifyPollToken,
} from "./pollToken";
import { generateTestJWT } from "./jwt";

/**
 * Unit tests for Poll Token Service
 *
 * Tests the generation and verification of signed poll tokens used by the
 * x402 deep research status endpoint. Poll tokens are self-validating JWTs
 * signed with BIOAGENTS_SECRET.
 *
 * These are pure unit tests — no DB, no HTTP, no external services.
 */

const TEST_SECRET = "test-secret-for-poll-token-unit-tests";
const DIFFERENT_SECRET = "a-completely-different-secret-key";

describe("Poll Token Service", () => {
  let originalSecret: string | undefined;
  let originalTTL: string | undefined;

  beforeAll(() => {
    originalSecret = process.env.BIOAGENTS_SECRET;
    originalTTL = process.env.POLL_TOKEN_TTL_SECONDS;
    process.env.BIOAGENTS_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    // Restore original env
    if (originalSecret !== undefined) {
      process.env.BIOAGENTS_SECRET = originalSecret;
    } else {
      delete process.env.BIOAGENTS_SECRET;
    }
    if (originalTTL !== undefined) {
      process.env.POLL_TOKEN_TTL_SECONDS = originalTTL;
    } else {
      delete process.env.POLL_TOKEN_TTL_SECONDS;
    }
  });

  beforeEach(() => {
    // Reset to default for each test
    process.env.BIOAGENTS_SECRET = TEST_SECRET;
    delete process.env.POLL_TOKEN_TTL_SECONDS;
  });

  describe("generatePollToken", () => {
    test("should generate a valid JWT string", async () => {
      const messageId = crypto.randomUUID();
      const token = await generatePollToken(messageId);

      expect(token).not.toBeNull();
      expect(typeof token).toBe("string");
      // JWT format: header.payload.signature
      expect(token!.split(".")).toHaveLength(3);
    });

    test("should return null when BIOAGENTS_SECRET is not set", async () => {
      delete process.env.BIOAGENTS_SECRET;

      const messageId = crypto.randomUUID();
      const token = await generatePollToken(messageId);

      expect(token).toBeNull();
    });

    test("should include messageId as sub claim", async () => {
      const messageId = crypto.randomUUID();
      const token = await generatePollToken(messageId);

      expect(token).not.toBeNull();

      // Decode and verify the sub claim
      const secretKey = new TextEncoder().encode(TEST_SECRET);
      const { payload } = await jose.jwtVerify(token!, secretKey, {
        algorithms: ["HS256"],
      });

      expect(payload.sub).toBe(messageId);
    });

    test("should include purpose='poll' claim", async () => {
      const messageId = crypto.randomUUID();
      const token = await generatePollToken(messageId);

      expect(token).not.toBeNull();

      const secretKey = new TextEncoder().encode(TEST_SECRET);
      const { payload } = await jose.jwtVerify(token!, secretKey, {
        algorithms: ["HS256"],
      });

      expect(payload.purpose).toBe("poll");
    });
  });

  describe("verifyPollToken", () => {
    test("should verify a valid poll token and return messageId", async () => {
      const messageId = crypto.randomUUID();
      const token = await generatePollToken(messageId);

      expect(token).not.toBeNull();

      const result = await verifyPollToken(token!);

      expect(result.valid).toBe(true);
      expect(result.messageId).toBe(messageId);
      expect(result.error).toBeUndefined();
    });

    test("should reject token signed with wrong secret", async () => {
      const messageId = crypto.randomUUID();
      const wrongKey = new TextEncoder().encode(DIFFERENT_SECRET);

      // Create a token signed with a different secret
      const token = await new jose.SignJWT({ purpose: "poll" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(messageId)
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(wrongKey);

      const result = await verifyPollToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("should reject expired token", async () => {
      const messageId = crypto.randomUUID();
      const secretKey = new TextEncoder().encode(TEST_SECRET);

      // Create a token that expired 1 hour ago
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      const token = await new jose.SignJWT({ purpose: "poll" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(messageId)
        .setIssuedAt(pastTime - 3600)
        .setExpirationTime(pastTime)
        .sign(secretKey);

      const result = await verifyPollToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("expired");
    });

    test("should reject token without purpose='poll' claim (regular user JWT)", async () => {
      // Use the existing generateTestJWT which creates a regular user JWT (no purpose claim)
      const userJWT = await generateTestJWT({ sub: "user-123" });

      const result = await verifyPollToken(userJWT);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("not a poll token");
    });

    test("should reject token without sub claim", async () => {
      const secretKey = new TextEncoder().encode(TEST_SECRET);

      // Create a token with purpose but no sub
      const token = await new jose.SignJWT({ purpose: "poll" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(secretKey);

      const result = await verifyPollToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("messageId");
    });

    test("should return error when BIOAGENTS_SECRET is not set", async () => {
      delete process.env.BIOAGENTS_SECRET;

      const result = await verifyPollToken("some.fake.token");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("BIOAGENTS_SECRET");
    });

    test("should reject garbage/malformed tokens", async () => {
      const result = await verifyPollToken("not-a-valid-jwt");

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("should reject empty string token", async () => {
      const result = await verifyPollToken("");

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("round-trip", () => {
    test("should generate then verify successfully with correct messageId", async () => {
      const messageId = crypto.randomUUID();

      const token = await generatePollToken(messageId);
      expect(token).not.toBeNull();

      const result = await verifyPollToken(token!);
      expect(result.valid).toBe(true);
      expect(result.messageId).toBe(messageId);
    });

    test("should respect POLL_TOKEN_TTL_SECONDS env var", async () => {
      // Set a very short TTL
      process.env.POLL_TOKEN_TTL_SECONDS = "3600"; // 1 hour

      const messageId = crypto.randomUUID();
      const token = await generatePollToken(messageId);

      expect(token).not.toBeNull();

      // Verify the token works
      const result = await verifyPollToken(token!);
      expect(result.valid).toBe(true);

      // Decode and check expiration is approximately 1 hour from now
      const secretKey = new TextEncoder().encode(TEST_SECRET);
      const { payload } = await jose.jwtVerify(token!, secretKey, {
        algorithms: ["HS256"],
      });

      const now = Math.floor(Date.now() / 1000);
      const expectedExp = now + 3600;
      // Allow 5 seconds of tolerance
      expect(payload.exp).toBeDefined();
      expect(Math.abs(payload.exp! - expectedExp)).toBeLessThan(5);
    });
  });
});
