# x402 Routes Test Suite

**Unit test coverage** for x402 payment-gated routes focusing on validation logic and error handling.

## Test Files

### Validation Tests
- **[chat.test.ts](chat.test.ts)** - Validation tests for `/api/x402/chat` endpoint
- **[research.test.ts](research.test.ts)** - Validation tests for `/api/x402/research` endpoint
- **[status.test.ts](status.test.ts)** - Tests for `/api/x402/research/status/:messageId` endpoint

**Note:** These are unit tests that test route handlers in isolation. They do not require a database connection or external services.

## Running Tests

### Run All Tests
```bash
bun test src/routes/x402/
```

### Run Specific Test File
```bash
# Chat route tests
bun test src/routes/x402/chat.test.ts

# Research route tests
bun test src/routes/x402/research.test.ts

# Status route tests
bun test src/routes/x402/status.test.ts

# Integration tests
bun test src/routes/x402/integration.test.ts
```

### Run with Watch Mode
```bash
bun test --watch src/routes/x402/
```

### Run with Coverage
```bash
bun test --coverage src/routes/x402/
```

## Test Coverage

### Chat Route (`chat.test.ts`)
- ✅ GET endpoint discovery (2 tests)
- ✅ POST request validation - missing/null/empty message (3 tests)
- ✅ Error handling - malformed JSON, empty body (2 tests)
- ✅ Response format validation (1 test)
- ✅ Error messages (2 tests)

**Total: 10 test cases**

### Research Route (`research.test.ts`)
- ✅ GET endpoint discovery (2 tests)
- ✅ POST request validation - missing/null/empty message (3 tests)
- ✅ Error handling - malformed JSON, empty body (2 tests)
- ✅ Response format validation (1 test)
- ✅ Error messages (2 tests)

**Total: 10 test cases**

### Status Route (`status.test.ts`)
- ✅ messageId parameter validation (5 tests)
- ✅ Response format validation (2 tests)
- ✅ Security tests - SQL injection, XSS, long IDs (3 tests)

**Total: 10 test cases**

**Grand Total: 30 test cases - ALL PASSING ✅**

## Test Structure

Each test file follows this structure:

```typescript
describe("Route Name", () => {
  let app: Elysia;

  beforeAll(() => {
    // Setup test app
  });

  afterAll(() => {
    // Cleanup
  });

  describe("Feature Group", () => {
    test("should do something", async () => {
      // Arrange
      const request = new Request(...);

      // Act
      const response = await app.handle(request);

      // Assert
      expect(response.status).toBe(200);
    });
  });
});
```

## What's Being Tested

### 1. Request Validation
- ✅ Required fields (message field presence check)
- ✅ Null value handling
- ✅ Empty string handling
- ✅ Malformed JSON requests
- ✅ Empty request body

### 2. Response Validation
- ✅ Status codes (200 for GET, 400 for validation errors)
- ✅ Content-Type headers (application/json)
- ✅ Error response structure (error property)
- ✅ Descriptive error messages

### 3. Discovery Endpoints
- ✅ GET /api/x402/chat returns discovery info
- ✅ GET /api/x402/research returns discovery info
- ✅ Proper JSON responses with documentation links

### 4. Security
- ✅ SQL injection attempts (safely rejected)
- ✅ XSS attempts (safely rejected)
- ✅ Buffer overflow attempts (very long inputs)
- ✅ Error messages don't expose internals

### 5. Status Endpoint
- ✅ messageId parameter handling
- ✅ UUID validation
- ✅ Non-existent message handling
- ✅ Database error handling

## Expected Behaviors

### Success Cases
- GET endpoints return discovery info (200)
- Valid POST requests proceed to payment check (not 400)
- Optional fields are accepted
- Proper Content-Type headers

### Failure Cases
- Missing required fields → 400
- Invalid field types → 400
- Malformed JSON → 400+
- Non-existent resources → 404
- Internal errors → 500

## Limitations

**IMPORTANT:** These are **unit tests** that run the route handlers in isolation. They test the validation logic and error handling, but **they are NOT integration tests** that connect to databases or run full chat pipelines.

These tests **do not** cover:
- ❌ Payment verification (x402 middleware disabled in test environment)
- ❌ Database operations (requires live database connection)
- ❌ Full chat pipeline execution (requires LLM APIs, planning, providers)
- ❌ Research job processing (requires background workers)
- ❌ External API calls (mocked or skipped)
- ❌ File uploads

These tests **focus on**:
- ✅ Route registration and discovery endpoints
- ✅ Request validation (required fields, field types)
- ✅ Basic error handling (malformed JSON, missing fields)
- ✅ Response format (status codes, error objects)
- ✅ Security basics (injection attempts, malformed input)

**Tests that pass validation will fail at database/pipeline stage** - this is expected behavior in unit tests. A test like "should accept optional conversationId" passing means "the route didn't reject it during validation", not "the full pipeline completed successfully".

## Adding New Tests

To add a new test:

1. Create test in appropriate file
2. Follow naming convention: `should [action]`
3. Use AAA pattern (Arrange, Act, Assert)
4. Keep tests independent
5. Use descriptive test names

Example:

```typescript
test("should reject empty message string", async () => {
  // Arrange
  const request = new Request("http://localhost/api/x402/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "" }),
  });

  // Act
  const response = await app.handle(request);

  // Assert
  expect(response.status).toBe(400);
  const data = await response.json();
  expect(data.error).toContain("message");
});
```

## Continuous Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test src/routes/x402/
```

## Debugging Failed Tests

If tests fail:

1. **Check test output** - Bun shows detailed errors
2. **Run single test** - Isolate the failing test
3. **Add console.log** - Debug test data
4. **Check test data** - Verify request/response format
5. **Update expectations** - If behavior changed intentionally

Example debug:

```typescript
test("debug example", async () => {
  const response = await app.handle(request);

  console.log("Status:", response.status);
  console.log("Headers:", response.headers);
  console.log("Body:", await response.text());

  expect(response.status).toBe(200);
});
```

## Best Practices

1. ✅ **Keep tests fast** - No database calls, no external APIs
2. ✅ **Test behavior, not implementation** - Test what happens, not how
3. ✅ **Use descriptive names** - "should reject invalid message" not "test1"
4. ✅ **One assertion per test** - Or closely related assertions
5. ✅ **Independent tests** - No shared state between tests
6. ✅ **Test edge cases** - Empty strings, null, very long inputs
7. ✅ **Test error paths** - Not just happy paths

## Next Steps

Future test improvements:
- [ ] Add mock x402 payment middleware
- [ ] Add mock database layer
- [ ] Add end-to-end tests with real server
- [ ] Add load testing
- [ ] Add mutation testing
- [ ] Add contract testing for API compatibility

## Support

For questions about tests:
1. Check this README
2. Look at existing test examples
3. Review Bun test documentation: https://bun.sh/docs/cli/test
