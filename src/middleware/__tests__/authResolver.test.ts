import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as jose from "jose";

// These private helpers are tested through the public resolveAuth API.
// constantTimeCompare is exercised via isValidApiKey (different-length secret
// takes the fast-reject path); JWT + none + optional modes cover the other
// branches.

const ENV_KEYS = ["AUTH_MODE", "BIOAGENTS_SECRET", "API_KEYS"] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
  // JWT service caches the secret-derived key; reset so the next test sees a
  // fresh secret.
  const { clearSecretKeyCache } = await import("../../services/jwt");
  clearSecretKeyCache();
});

describe("resolveAuth — AUTH_MODE=none", () => {
  test("accepts X-User-Id header and reports anonymous", async () => {
    process.env.AUTH_MODE = "none";
    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { "X-User-Id": "test-user-123" },
    });
    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(true);
    expect(result.userId).toBe("test-user-123");
    expect(result.method).toBe("anonymous");
  });

  test("falls back to body userId when no header", async () => {
    process.env.AUTH_MODE = "none";
    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test");
    const result = await resolveAuth(request, { userId: "body-user-456" });
    expect(result.authenticated).toBe(true);
    expect(result.userId).toBe("body-user-456");
    expect(result.method).toBe("anonymous");
  });

  test("generates a UUID when no header or body userId", async () => {
    process.env.AUTH_MODE = "none";
    const { resolveAuth } = await import("../authResolver");
    const result = await resolveAuth(new Request("http://localhost/api/test"));
    expect(result.authenticated).toBe(true);
    // UUID v4 shape
    expect(result.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe("resolveAuth — API key path", () => {
  test("accepts matching X-API-Key", async () => {
    process.env.AUTH_MODE = "jwt";
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
  });

  test("rejects wrong-length API key (constantTimeCompare fast-reject)", async () => {
    process.env.AUTH_MODE = "jwt";
    process.env.BIOAGENTS_SECRET = "correct-secret";
    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { "X-API-Key": "short" },
    });
    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(false);
  });

  test("rejects wrong-value, same-length API key", async () => {
    process.env.AUTH_MODE = "jwt";
    process.env.BIOAGENTS_SECRET = "correct-secret";
    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { "X-API-Key": "wrongxxsecret!" }, // same length as "correct-secret"
    });
    expect("wrongxxsecret!".length).toBe("correct-secret".length);
    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(false);
  });

  test("rejects API key when no secret configured", async () => {
    process.env.AUTH_MODE = "jwt";
    delete process.env.BIOAGENTS_SECRET;
    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { "X-API-Key": "anything" },
    });
    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(false);
  });
});

describe("resolveAuth — JWT path", () => {
  test("accepts a valid HS256 JWT and reports method=jwt", async () => {
    process.env.AUTH_MODE = "jwt";
    process.env.BIOAGENTS_SECRET = "jwt-test-secret";
    const secretKey = new TextEncoder().encode("jwt-test-secret");
    const token = await new jose.SignJWT({ email: "u@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-jwt-1")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secretKey);

    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(true);
    expect(result.method).toBe("jwt");
    expect(result.userId).toBe("user-jwt-1");
  });

  test("rejects a JWT signed with a different secret", async () => {
    process.env.AUTH_MODE = "jwt";
    process.env.BIOAGENTS_SECRET = "right-secret";
    const wrongKey = new TextEncoder().encode("wrong-secret-value");
    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-x")
      .setExpirationTime("1h")
      .sign(wrongKey);

    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(false);
  });

  test("rejects an expired JWT", async () => {
    process.env.AUTH_MODE = "jwt";
    process.env.BIOAGENTS_SECRET = "jwt-test-secret";
    const secretKey = new TextEncoder().encode("jwt-test-secret");
    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-exp")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secretKey);

    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(false);
  });
});

describe("resolveAuth — strict mode without credentials", () => {
  test("rejects request with no auth when mode=jwt", async () => {
    process.env.AUTH_MODE = "jwt";
    process.env.BIOAGENTS_SECRET = "any-secret";
    const { resolveAuth } = await import("../authResolver");
    const request = new Request("http://localhost/api/test");
    const result = await resolveAuth(request);
    expect(result.authenticated).toBe(false);
    expect(result.userId).toBeUndefined();
  });
});
