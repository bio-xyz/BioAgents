# x402 Stage 1: Separated Routes (Simple Implementation)

## Overview

Stage 1 provides **separated x402 routes** that work exactly like the existing chat and deep-research routes, but are dedicated for x402 payment consumers.

**Key Points:**
- ✅ Clean separation of x402 routes from UI-based routes
- ✅ Same immediate response pattern (not job-based yet)
- ✅ Uses `x402_agent` source for all x402 requests
- ✅ No authentication required (payment only via X-PAYMENT header)
- ✅ Works with existing payment system and conversation storage

## New Endpoints

### POST /api/x402/chat
Dedicated chat endpoint for x402 consumers.

**Request:**
```bash
curl -X POST http://localhost:3000/api/x402/chat \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <payment_header>" \
  -d '{
    "message": "What are senolytics?",
    "conversationId": "optional-uuid-for-multi-turn",
    "userId": "optional-user-id"
  }'
```

**Response (immediate):**
```json
{
  "text": "Senolytics are drugs that selectively...",
  "files": []
}
```

### POST /api/x402/research
Dedicated deep research endpoint for x402 consumers.

**Request:**
```bash
curl -X POST http://localhost:3000/api/x402/research \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <payment_header>" \
  -d '{
    "message": "Goals: Find anti-aging compounds\nRequirements: Published in last 5 years\nDatasets: No datasets\nPrior Works: No prior works\nExperiment Ideas: Test in aged mice\nDesired Outputs: Comprehensive report",
    "conversationId": "optional-uuid",
    "userId": "optional-user-id"
  }'
```

**Response (immediate):**
```json
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "status": "processing"
}
```

### GET /api/x402/research/status/:messageId
Check the status of an x402 research job.

**Request:**
```bash
curl http://localhost:3000/api/x402/research/status/<messageId>
```

**Response (processing):**
```json
{
  "status": "processing",
  "messageId": "uuid",
  "conversationId": "uuid",
  "progress": {
    "currentStep": "literature_gathering",
    "completedSteps": ["planning", "file_processing"]
  }
}
```

**Response (completed):**
```json
{
  "status": "completed",
  "messageId": "uuid",
  "conversationId": "uuid",
  "result": {
    "text": "Research results...",
    "papers": [...],
    "webSearchResults": [...]
  }
}
```

**Response (failed):**
```json
{
  "status": "failed",
  "messageId": "uuid",
  "conversationId": "uuid",
  "error": "Error message"
}
```

### GET /api/x402/chat
Discovery endpoint for x402scan.

### GET /api/x402/research
Discovery endpoint for x402scan.

## Implementation Details

### Files Created

1. **[src/routes/x402/chat.ts](src/routes/x402/chat.ts)** - x402 chat route
   - Same logic as `/api/chat`
   - Uses `x402_agent` source
   - No authentication middleware
   - Only x402 payment middleware

2. **[src/routes/x402/research.ts](src/routes/x402/research.ts)** - x402 research route
   - Same logic as `/api/deep-research/start`
   - Uses `x402_agent` source
   - Includes validation
   - Background processing

3. **[src/routes/x402/status.ts](src/routes/x402/status.ts)** - x402 research status route
   - Check research job progress
   - Verifies message is from x402_agent source
   - Returns processing/completed/failed status

4. **[src/index.ts](src/index.ts)** - Updated to register new routes

### Route Comparison

| Feature | `/api/chat` | `/api/x402/chat` |
|---------|-------------|------------------|
| Auth | Privy JWT or CDP signature | None (payment only) |
| Payment | Optional (bypassed for Privy) | Required (X-PAYMENT header) |
| Source | `ui`, `dev_ui`, or `x402_agent` | Always `x402_agent` |
| User | Real users or system user | Always system user |
| Response | Immediate | Immediate |

| Feature | `/api/deep-research/start` | `/api/x402/research` |
|---------|----------------------------|----------------------|
| Auth | Privy JWT or CDP signature | None (payment only) |
| Payment | Optional (bypassed for Privy) | Required (X-PAYMENT header) |
| Source | `ui`, `dev_ui`, or `x402_agent` | Always `x402_agent` |
| User | Real users or system user | Always system user |
| Response | messageId (processing) | messageId (processing) |

## How It Works

```
Client → POST /api/x402/chat + X-PAYMENT
  ↓
x402Middleware (verify & settle payment)
  ↓
Create conversation under system user (source: x402_agent)
  ↓
Run chat pipeline (planning → providers → action → reflection)
  ↓
Return immediate response with result
```

## Benefits of Separation

1. **Clean Codebase** - x402 logic isolated from UI routes
2. **Easy Monitoring** - Track x402 requests separately (source: `x402_agent`)
3. **Flexible Evolution** - Can evolve x402 routes independently
4. **Better Analytics** - Separate metrics for x402 consumers
5. **No Breaking Changes** - Existing routes remain unchanged

## Multi-Turn Conversations

x402 consumers can maintain conversations by passing `conversationId`:

```bash
# First request
curl -X POST http://localhost:3000/api/x402/chat \
  -H "X-PAYMENT: ..." \
  -d '{"message": "What are senolytics?"}'

# Response includes conversationId
# Store it for follow-up requests

# Follow-up request
curl -X POST http://localhost:3000/api/x402/chat \
  -H "X-PAYMENT: ..." \
  -d '{
    "message": "Tell me more",
    "conversationId": "<saved-conversation-id>"
  }'
```

## Database Storage

All x402 requests are stored using the existing system:
- **conversations** - Created under system user (`00000000-0000-0000-0000-000000000000`)
- **messages** - Source set to `x402_agent`
- **x402_external** - Payment tracking (existing table)

Query x402 requests:
```sql
-- Find all x402 conversations
SELECT * FROM conversations WHERE user_id = '00000000-0000-0000-0000-000000000000';

-- Find all x402 messages
SELECT * FROM messages WHERE source = 'x402_agent' ORDER BY created_at DESC;

-- Find x402 payments
SELECT * FROM x402_external ORDER BY created_at DESC;
```

## Testing

### Test x402 Chat

```bash
# 1. Start server
bun run dev

# 2. Test without payment (should return 402)
curl -X POST http://localhost:3000/api/x402/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Test"}'

# 3. Test with payment
curl -X POST http://localhost:3000/api/x402/chat \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <valid_payment_header>" \
  -d '{"message": "What are senolytics?"}'
```

### Test x402 Research

```bash
# Test with payment
curl -X POST http://localhost:3000/api/x402/research \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <valid_payment_header>" \
  -d '{
    "message": "Goals: Research anti-aging compounds\nRequirements: Focus on senolytics\nDatasets: No datasets\nPrior Works: No prior works\nExperiment Ideas: In vitro testing\nDesired Outputs: Summary report"
  }'

# Response: { "messageId": "...", "conversationId": "...", "status": "processing" }

# Check status
curl http://localhost:3000/api/deep-research/status/<messageId>
```

## Configuration

Uses existing x402 configuration:

```bash
# .env
X402_ENABLED=true
X402_ENVIRONMENT=testnet
X402_PAYMENT_ADDRESS=0x...
X402_NETWORK=base-sepolia
```

No additional configuration needed!

## Next Steps (Future Stages)

Stage 1 is complete. Future stages could include:

**Stage 2: Job-Based Processing**
- Async job queue
- Status polling endpoint
- Better scalability

**Stage 3: External Sessions**
- Wallet-based sessions (no synthetic users)
- Session analytics
- Better tracking

**Stage 4: Advanced Features**
- Webhooks for job completion
- Rate limiting per wallet
- Advanced monitoring

## Summary

✅ **Stage 1 Complete!**

You now have:
- Separated x402 routes at `/api/x402/chat` and `/api/x402/research`
- Same functionality as existing routes
- Clean isolation from UI-based routes
- No breaking changes to existing system
- Ready to deploy and test

The implementation is simple, clean, and production-ready for stage 1!
