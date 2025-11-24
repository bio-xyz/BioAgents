import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import { x402ChatRoute, x402ChatRouteGet } from "./chat";

/**
 * Unit tests for x402 Chat Route
 *
 * NOTE: These are unit tests that focus on validation logic.
 * They do NOT test:
 * - x402 payment processing (middleware disabled in tests)
 * - Database operations (no DB connection)
 * - Full chat pipeline (no LLM calls)
 *
 * Tests that pass validation will fail at setup/execution stage - this is expected.
 */

describe("x402 Chat Route", () => {
  let app: Elysia;

  beforeAll(() => {
    app = new Elysia()
      .use(x402ChatRouteGet)
      .use(x402ChatRoute);
  });

  afterAll(async () => {
    try {
      // Cleanup - may not be needed if not listening
    } catch (e) {
      // Ignore
    }
  });

  describe("GET /api/x402/chat - Discovery", () => {
    test("should return discovery information", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "GET",
        })
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("message");
      expect(data.message).toContain("x402 Chat API");
      expect(data).toHaveProperty("documentation");
    });

    test("should have correct content type", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "GET",
        })
      );

      expect(response.headers.get("Content-Type")).toContain("application/json");
    });
  });

  describe("POST /api/x402/chat - Validation", () => {
    test("should reject request without message field", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })
      );

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(data.error).toContain("message");
    });

    test("should reject null message", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: null,
          }),
        })
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should reject empty message", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "",
          }),
        })
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });
  });

  describe("POST /api/x402/chat - Request Format", () => {
    test("should handle malformed JSON", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: "{ invalid json",
        })
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("should handle empty body", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: "",
        })
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("should return JSON response", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })
      );

      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("application/json");
    });
  });

  describe("POST /api/x402/chat - Error Messages", () => {
    test("should return error object on validation failure", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: null,
          }),
        })
      );

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
      expect(data.error.length).toBeGreaterThan(0);
    });

    test("should include descriptive error message", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })
      );

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain("message");
    });
  });
});
