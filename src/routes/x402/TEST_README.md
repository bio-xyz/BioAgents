# x402 Route Tests

## Overview

Unit tests for x402 payment-gated API routes. These tests focus on **validation logic, authentication, and security** — they do NOT test actual x402 payment processing, database operations, or LLM pipelines.

## Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `deep-research.test.ts` | ~15 | Poll token validation, status endpoint security, start endpoint |
| `chat.test.ts` | ~10 | Payment gate behavior, request format, error handling |
| `../../services/pollToken.test.ts` | ~12 | Poll token generation, verification, round-trip, edge cases |

**Total: ~37 test cases**

## Running Tests

```bash
# All x402 route tests
bun test src/routes/x402/

# Poll token service tests
bun test src/services/pollToken.test.ts

# All tests
bun test

# Specific file
bun test src/routes/x402/deep-research.test.ts
```

## Test Approach

### What is tested

- **Poll token validation** (the core of PR #133 security fix):
  - Missing token → 401
  - Invalid/garbage token → 401
  - Expired token → 401
  - Regular user JWT (no `purpose: "poll"`) → 401
  - Token for wrong messageId → 403
  - Valid token via `?token=` query param → passes auth
  - Valid token via `Authorization: Bearer` header → passes auth

- **Poll token service** (unit tests):
  - Generate/verify round-trip
  - Expired token rejection
  - Wrong signature rejection
  - Missing claims rejection
  - Environment variable handling (`BIOAGENTS_SECRET`, `POLL_TOKEN_TTL_SECONDS`)

- **Security**:
  - SQL injection attempts in messageId
  - XSS attempts in messageId
  - Very long messageId (buffer overflow)

- **Request validation**:
  - Missing required fields
  - Malformed JSON
  - Empty body
  - Response format (JSON, correct structure)

### What is NOT tested

- x402 payment protocol (signature verification, settlement)
- Database operations (message/state CRUD)
- LLM/agent pipeline execution
- Full end-to-end deep research flow
- b402 routes (deprioritized, known broken)

### Test Philosophy

Tests use `app.handle(new Request(...))` — Elysia's built-in request handling without starting an HTTP server. This means:

1. **Auth layer tests**: With valid poll token, the request passes auth but fails at DB lookup (404/500). We assert `status !== 401 && status !== 403` to verify auth passed.
2. **Negative auth tests**: We assert exact status codes (401, 403) and error messages.
3. **Payment gate tests**: Without x402 payment headers, POST requests get blocked by middleware (402/500).

## Environment Setup

Tests require `BIOAGENTS_SECRET` to be set (for JWT signing). Test files set this in `beforeAll`:

```typescript
process.env.BIOAGENTS_SECRET = "test-secret-for-tests";
```

No database, Redis, or external services needed.

## Adding New Tests

When adding tests:
1. Follow the existing pattern of `describe` blocks per endpoint
2. Use `crypto.randomUUID()` for test messageIds
3. Use `generatePollToken()` for valid tokens, `jose.SignJWT` for crafting invalid/expired tokens
4. Use `generateTestJWT()` to create regular user JWTs (should be rejected by poll token validation)
5. Don't test DB-dependent behavior (that requires integration tests)
