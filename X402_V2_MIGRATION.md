# x402 V2 Migration Plan for BioAgents

**Status:** Phase 4 Complete ✅  
**Created:** 2026-02-04  
**Author:** Gaia (AI)

---

## Executive Summary

Migrate BioAgents from x402 v1 (`x402@0.7.1`) to x402 v2 (`@x402/*@2.2.0`) across all payment-gated routes (chat, deep-research).

**Approach:** Clean v2 migration (no backward compatibility with v1)

---

## Test Wallet

- **Address:** `0xE58A8d9D004807582e616b658324fa9E10911aE8`
- **Private Key:** Stored in `/data/.clawdbot/credentials/x402_test_wallet_pk`
- **Network:** Base Mainnet
- **Balance:** 2.00 USDC + 0.005 ETH

---

## Implementation Status

### Phase 1: Dependencies & Config ✅ 
- [x] Update `package.json` with v2 packages (removed `@coinbase/x402`, `x402`, `x402-fetch`)
- [x] Add new v2 deps: `@x402/core@^2.2.0`, `@x402/evm@^2.2.0`, `@x402/fetch@^2.2.0`
- [x] Run `bun install` - 753 packages installed

### Phase 2: Service Layer ✅
- [x] Rewrite `src/middleware/x402/service.ts`
  - [x] Import from `@x402/core/http`, `@x402/core/types`
  - [x] Use `HTTPFacilitatorClient` for verify/settle
  - [x] Updated `generatePaymentRequirement()` for v2 schema (amount, not maxAmountRequired)
  - [x] Updated `generatePaymentRequired()` with ResourceInfo and extensions
  - [x] Updated header encoding/decoding for v2

### Phase 3: Middleware ✅
- [x] Update `src/middleware/x402/middleware.ts`
  - [x] Changed header: `X-PAYMENT` → `PAYMENT-SIGNATURE` (with legacy fallback)
  - [x] Updated 402 response format for v2 (includes resource, accepts, extensions)
  - [x] Changed response header: `X-PAYMENT-RESPONSE` → `PAYMENT-RESPONSE`

### Phase 4: Routes ✅
- [x] Update `src/routes/x402/chat.ts`
  - [x] Uses v2 service for payment required responses
- [x] Update `src/routes/x402/deep-research.ts`
  - [x] Uses v2 service for payment required responses
- [x] Update `src/routes/x402/index.ts`
  - [x] Config endpoint returns v2 info (x402Version: 2, new header names)
  - [x] Health endpoint checks facilitator availability
- [x] Update `src/index.ts` CORS headers
  - [x] Added `PAYMENT-SIGNATURE` to allowedHeaders
  - [x] Added `PAYMENT-RESPONSE`, `PAYMENT-REQUIRED` to exposeHeaders

### Phase 5: Testing ⏳
- [ ] Start BioAgents locally with x402 enabled
- [ ] Call `/api/x402/config` - verify v2 schema
- [ ] Call `/api/x402/chat` (GET) - verify 402 response format
- [ ] Integration test against facilitator
- [ ] End-to-end test with real payment ($0.01)

---

## V2 Type Changes Summary

### V1 PaymentRequirements:
```typescript
{
  scheme, network, maxAmountRequired, resource, description,
  mimeType, outputSchema, payTo, maxTimeoutSeconds, asset, extra
}
```

### V2 PaymentRequirements:
```typescript
{
  scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra
}
```

### V2 PaymentRequired (full 402 response):
```typescript
{
  x402Version: 2,
  resource: { url, description, mimeType },
  accepts: [PaymentRequirements[]],
  extensions?: { outputSchema, ... },
  error?: string
}
```

---

## Files Modified

| File | Changes |
|------|---------|
| `package.json` | Removed v1 deps, added v2 deps |
| `src/middleware/x402/service.ts` | Complete rewrite for v2 API |
| `src/middleware/x402/middleware.ts` | New header names, v2 response format |
| `src/routes/x402/index.ts` | Config endpoint returns v2 info |
| `src/routes/x402/chat.ts` | Uses v2 service |
| `src/routes/x402/deep-research.ts` | Uses v2 service |
| `src/index.ts` | CORS headers updated |

---

## Environment Variables

```bash
# Required for x402 v2
X402_ENABLED=true
X402_ENVIRONMENT=mainnet  # or testnet
X402_PAYMENT_ADDRESS=0x...  # Your receiving address
X402_NETWORK=base  # or base-sepolia for testnet
X402_FACILITATOR_URL=https://x402.org/facilitator

# For CDP facilitator (optional, for production)
CDP_API_KEY_ID=xxx
CDP_API_KEY_SECRET=xxx
```

---

## New Header Names (V2)

| Purpose | V1 | V2 |
|---------|----|----|
| Client sends payment | `X-PAYMENT` | `PAYMENT-SIGNATURE` |
| Server settlement response | `X-PAYMENT-RESPONSE` | `PAYMENT-RESPONSE` |
| 402 body format | x402Version: 1 | x402Version: 2 |

---

## Resources

- [x402 V2 Launch Blog](https://www.x402.org/writing/x402-v2-launch)
- [x402 GitHub](https://github.com/coinbase/x402)
- [x402 SDK Docs](https://x402.org/docs)

---

## Progress Log

| Date | Phase | Notes |
|------|-------|-------|
| 2026-02-04 | Plan Created | Initial analysis complete |
| 2026-02-04 | Phase 1 | Dependencies updated, bun install successful |
| 2026-02-04 | Phase 2-4 | Service, middleware, routes rewritten for v2 |
| | Phase 5 | Awaiting integration test |
