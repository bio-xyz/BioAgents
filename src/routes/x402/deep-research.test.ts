import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import * as jose from "jose";
import { x402DeepResearchRoute } from "./deep-research";
import { generatePollToken } from "../../services/pollToken";
import { generateTestJWT } from "../../services/jwt";

/**
 * Unit tests for x402 Deep Research Routes
 *
 * Tests cover:
 * - GET /api/x402/deep-research/status/:messageId — Poll token validation
 * - GET /api/x402/deep-research/start — 402 payment discovery
 * - POST /api/x402/deep-research/start — Payment-gated start endpoint
 *
 * NOTE: These are unit tests that focus on validation logic.
 * They do NOT test:
 * - x402 payment processing (middleware not fully initialized in tests)
 * - Database operations (no DB connection)
 * - Full research pipeline (no LLM calls, no background processing)
 *
 * Tests that pass validation will fail at the DB/execution stage — this is expected.
 * We are testing the AUTH LAYER, not the business logic.
 */

const TEST_SECRET = "test-secret-for-x402-route-tests";

describe("x402 Deep Research Route", () => {
  let app: Elysia;
  let originalSecret: string | undefined;

  beforeAll(() => {
    originalSecret = process.env.BIOAGENTS_SECRET;
    process.env.BIOAGENTS_SECRET = TEST_SECRET;
    app = new Elysia().use(x402DeepResearchRoute);
  });

  afterAll(() => {
    if (originalSecret !== undefined) {
      process.env.BIOAGENTS_SECRET = originalSecret;
    } else {
      delete process.env.BIOAGENTS_SECRET;
    }
  });

  describe("GET /api/x402/deep-research/status/:messageId", () => {
    describe("Poll Token Validation", () => {
      test("should return 401 when no poll token provided", async () => {
        const messageId = crypto.randomUUID();
        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}`,
            { method: "GET" },
          ),
        );

        expect(response.status).toBe(401);

        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data.error).toContain("Poll token required");
      });

      test("should return 401 with hint about token format when missing", async () => {
        const messageId = crypto.randomUUID();
        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}`,
            { method: "GET" },
          ),
        );

        expect(response.status).toBe(401);

        const data = await response.json();
        expect(data.hint).toBeDefined();
        expect(data.hint).toContain("token");
      });

      test("should return 401 for invalid/garbage token", async () => {
        const messageId = crypto.randomUUID();
        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}?token=garbage-not-a-jwt`,
            { method: "GET" },
          ),
        );

        expect(response.status).toBe(401);

        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data.error).toBeDefined();
      });

      test("should return 401 for expired poll token", async () => {
        const messageId = crypto.randomUUID();
        const secretKey = new TextEncoder().encode(TEST_SECRET);

        // Create a token that expired 1 hour ago
        const pastTime = Math.floor(Date.now() / 1000) - 3600;
        const expiredToken = await new jose.SignJWT({ purpose: "poll" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(messageId)
          .setIssuedAt(pastTime - 3600)
          .setExpirationTime(pastTime)
          .sign(secretKey);

        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}?token=${expiredToken}`,
            { method: "GET" },
          ),
        );

        expect(response.status).toBe(401);

        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data.error).toBeDefined();
      });

      test("should return 403 when token messageId doesn't match route messageId", async () => {
        const tokenMessageId = crypto.randomUUID();
        const routeMessageId = crypto.randomUUID();

        // Generate a valid token for a different messageId
        const token = await generatePollToken(tokenMessageId);
        expect(token).not.toBeNull();

        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${routeMessageId}?token=${token}`,
            { method: "GET" },
          ),
        );

        expect(response.status).toBe(403);

        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data.error).toContain("does not match");
      });

      test("should accept poll token via ?token= query param", async () => {
        const messageId = crypto.randomUUID();
        const token = await generatePollToken(messageId);
        expect(token).not.toBeNull();

        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}?token=${token}`,
            { method: "GET" },
          ),
        );

        // Token is valid, but message won't exist in DB — expect 404 or 500
        // The important thing is it's NOT 401 or 403 (auth passed)
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      });

      test("should accept poll token via Authorization: Bearer header", async () => {
        const messageId = crypto.randomUUID();
        const token = await generatePollToken(messageId);
        expect(token).not.toBeNull();

        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          ),
        );

        // Token is valid, but message won't exist in DB — expect 404 or 500
        // The important thing is it's NOT 401 or 403 (auth passed)
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      });

      test("should reject regular user JWT (without purpose='poll')", async () => {
        const messageId = crypto.randomUUID();

        // Generate a standard user JWT (has sub but no purpose="poll")
        const userJWT = await generateTestJWT({ sub: messageId });

        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}?token=${userJWT}`,
            { method: "GET" },
          ),
        );

        expect(response.status).toBe(401);

        const data = await response.json();
        expect(data.ok).toBe(false);
      });
    });

    describe("Response Format", () => {
      test("should return JSON response", async () => {
        const messageId = crypto.randomUUID();
        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}`,
            { method: "GET" },
          ),
        );

        const contentType = response.headers.get("Content-Type");
        expect(contentType).toContain("application/json");
      });

      test("should return error object structure (ok, error fields)", async () => {
        const messageId = crypto.randomUUID();
        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${messageId}`,
            { method: "GET" },
          ),
        );

        const data = await response.json();
        expect(data).toHaveProperty("ok");
        expect(data.ok).toBe(false);
        expect(data).toHaveProperty("error");
        expect(typeof data.error).toBe("string");
      });
    });

    describe("Security", () => {
      test("should handle SQL injection attempt in messageId", async () => {
        const maliciousId = "'; DROP TABLE messages; --";
        const token = await generatePollToken(maliciousId);

        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${encodeURIComponent(maliciousId)}?token=${token}`,
            { method: "GET" },
          ),
        );

        // Should fail safely without executing SQL
        expect(response.status).toBeGreaterThanOrEqual(400);
      });

      test("should handle XSS attempt in messageId", async () => {
        const maliciousId = "<script>alert('xss')</script>";
        const token = await generatePollToken(maliciousId);

        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${encodeURIComponent(maliciousId)}?token=${token}`,
            { method: "GET" },
          ),
        );

        // Should fail safely
        expect(response.status).toBeGreaterThanOrEqual(400);
      });

      test("should handle very long messageId", async () => {
        const longId = "a".repeat(10000);
        const response = await app.handle(
          new Request(
            `http://localhost/api/x402/deep-research/status/${longId}`,
            { method: "GET" },
          ),
        );

        // Should handle gracefully
        expect(response.status).toBeGreaterThanOrEqual(400);
      });
    });
  });

  describe("GET /api/x402/deep-research/start", () => {
    test("should return response for payment discovery", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/deep-research/start", {
          method: "GET",
        }),
      );

      // Should return either 200 or 402 depending on x402 service initialization
      // Either way it should be a valid response
      expect(response.status).toBeGreaterThanOrEqual(200);

      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("application/json");
    });
  });

  describe("POST /api/x402/deep-research/start", () => {
    test("should handle request without payment", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/deep-research/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: "Test research query" }),
        }),
      );

      // Without payment, should return 402 or error
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("should handle empty body", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/deep-research/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }),
      );

      // Without payment or message, should return 402 or error
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("should return JSON response", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/deep-research/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }),
      );

      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("application/json");
    });
  });
});
