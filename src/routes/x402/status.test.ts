import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import { x402ResearchStatusRoute } from "./status";

describe("x402 Research Status Route", () => {
  let app: Elysia;

  beforeAll(() => {
    app = new Elysia().use(x402ResearchStatusRoute);
  });

  afterAll(() => {
    app.stop();
  });

  describe("GET /api/x402/research/status/:messageId", () => {
    test("should require messageId parameter", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/research/status/", {
          method: "GET",
        })
      );

      // Should either not match route or return 400
      expect([400, 404]).toContain(response.status);
    });

    test("should accept valid UUID messageId", async () => {
      const messageId = crypto.randomUUID();
      const response = await app.handle(
        new Request(`http://localhost/api/x402/research/status/${messageId}`, {
          method: "GET",
        })
      );

      // Will fail with 404 (message not found) or 500 (DB error), but not validation error
      expect([404, 500]).toContain(response.status);
    });

    test("should handle non-UUID messageId", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/research/status/invalid-id", {
          method: "GET",
        })
      );

      // Should fail with 404 or 500
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("should return JSON response", async () => {
      const messageId = crypto.randomUUID();
      const response = await app.handle(
        new Request(`http://localhost/api/x402/research/status/${messageId}`, {
          method: "GET",
        })
      );

      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("application/json");
    });

    test("should return error object for non-existent message", async () => {
      const messageId = crypto.randomUUID();
      const response = await app.handle(
        new Request(`http://localhost/api/x402/research/status/${messageId}`, {
          method: "GET",
        })
      );

      expect([404, 500]).toContain(response.status);

      const data = await response.json();
      expect(data).toHaveProperty("ok");
      expect(data.ok).toBe(false);
      expect(data).toHaveProperty("error");
    });
  });

  describe("GET /api/x402/research/status/:messageId - Response Format", () => {
    test("should return structured error response", async () => {
      const messageId = crypto.randomUUID();
      const response = await app.handle(
        new Request(`http://localhost/api/x402/research/status/${messageId}`, {
          method: "GET",
        })
      );

      const data = await response.json();
      expect(data).toBeDefined();
      expect(typeof data).toBe("object");
    });

    test("should include error field on failure", async () => {
      const messageId = crypto.randomUUID();
      const response = await app.handle(
        new Request(`http://localhost/api/x402/research/status/${messageId}`, {
          method: "GET",
        })
      );

      const data = await response.json();
      if (!data.ok) {
        expect(data).toHaveProperty("error");
        expect(typeof data.error).toBe("string");
      }
    });
  });

  describe("GET /api/x402/research/status/:messageId - Security", () => {
    test("should handle SQL injection attempt in messageId", async () => {
      const maliciousId = "'; DROP TABLE messages; --";
      const response = await app.handle(
        new Request(`http://localhost/api/x402/research/status/${encodeURIComponent(maliciousId)}`, {
          method: "GET",
        })
      );

      // Should fail safely without executing SQL
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("should handle XSS attempt in messageId", async () => {
      const maliciousId = "<script>alert('xss')</script>";
      const response = await app.handle(
        new Request(`http://localhost/api/x402/research/status/${encodeURIComponent(maliciousId)}`, {
          method: "GET",
        })
      );

      // Should fail safely
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("should handle very long messageId", async () => {
      const longId = "a".repeat(10000);
      const response = await app.handle(
        new Request(`http://localhost/api/x402/research/status/${longId}`, {
          method: "GET",
        })
      );

      // Should handle gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
