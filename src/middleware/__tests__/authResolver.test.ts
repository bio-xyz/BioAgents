import { describe, expect, test } from "bun:test";

// We import the module to test the non-exported helpers indirectly.
// constantTimeCompare and resolveProvidedUserId are private, so we test
// them through the exported functions that use them.

// For constantTimeCompare, we test via isValidApiKey behavior.
// For resolveProvidedUserId, we test via resolveAuth behavior.

// However, we CAN test resolveAuth directly since it's exported.
// We need to set env vars for the auth config.

describe("authResolver helpers (via resolveAuth)", () => {
  test("resolveAuth returns anonymous when AUTH_MODE=none", async () => {
    const origMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "none";

    // Dynamic import to pick up env changes
    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { "X-User-Id": "test-user-123" },
    });

    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(true);
    expect(result.userId).toBe("test-user-123");
    expect(result.method).toBe("anonymous");

    process.env.AUTH_MODE = origMode;
  });

  test("resolveAuth uses body userId when no header", async () => {
    const origMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "none";

    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test");
    const body = { userId: "body-user-456" };

    const result = await resolveAuth(request, body);
    expect(result.authenticated).toBe(true);
    expect(result.userId).toBe("body-user-456");

    process.env.AUTH_MODE = origMode;
  });

  test("resolveAuth validates API key via X-API-Key header", async () => {
    const origMode = process.env.AUTH_MODE;
    const origSecret = process.env.BIOAGENTS_SECRET;
    process.env.AUTH_MODE = "jwt"; // strict mode
    process.env.BIOAGENTS_SECRET = "test-secret-key";

    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: {
        "X-API-Key": "test-secret-key",
        "X-User-Id": "api-user-789",
      },
    });

    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(true);
    expect(result.method).toBe("api_key");
    expect(result.userId).toBe("api-user-789");

    process.env.AUTH_MODE = origMode;
    process.env.BIOAGENTS_SECRET = origSecret;
  });

  test("resolveAuth rejects invalid API key", async () => {
    const origMode = process.env.AUTH_MODE;
    const origSecret = process.env.BIOAGENTS_SECRET;
    process.env.AUTH_MODE = "jwt";
    process.env.BIOAGENTS_SECRET = "correct-secret";

    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { "X-API-Key": "wrong-secret" },
    });

    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(false);

    process.env.AUTH_MODE = origMode;
    process.env.BIOAGENTS_SECRET = origSecret;
  });
});
