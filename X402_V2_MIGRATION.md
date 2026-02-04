# x402 V2 Migration Plan for BioAgents

**Status:** In Progress  
**Created:** 2026-02-04  
**Author:** Gaia (AI)

---

## Executive Summary

Migrate BioAgents from x402 v1 (`x402@0.7.1`) to x402 v2 (`@x402/*@2.2.0`) across all payment-gated routes (chat, deep-research).

**Approach:** Clean v2 migration (no backward compatibility with v1)

---

## Test Wallet

- **Address:** `0xd460447EEB14E970C935E32731d512A68903E4c1`
- **Private Key:** Stored in `/data/.clawdbot/credentials/x402_test_wallet_pk`
- **Network:** Base Mainnet
- **Balance:** 2.00 USDC + 0.005 ETH

---

## Current State

### Files to Modify

```
src/middleware/x402/
├── config.ts       # Network/env config
├── middleware.ts   # Payment validation middleware  
├── pricing.ts      # Route pricing (likely unchanged)
└── service.ts      # Payment verification/settlement

src/routes/x402/
├── index.ts        # Config/pricing/health endpoints
├── chat.ts         # Payment-gated chat
└── deep-research.ts # Payment-gated research

package.json        # Dependencies
```

### Current Dependencies (v1)
```json
"@coinbase/x402": "^0.7.0",
"x402": "^0.7.1",
"x402-fetch": "^0.7.0"
```

### Target Dependencies (v2)
```json
"@x402/core": "^2.2.0",
"@x402/evm": "^2.2.0",
"@x402/fetch": "^2.2.0"
```

---

## Key V1 → V2 Changes

| Aspect | V1 | V2 |
|--------|----|----|
| Package | `x402`, `@coinbase/x402` | `@x402/core`, `@x402/evm` |
| Headers | `X-PAYMENT`, `X-PAYMENT-RESPONSE` | `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` |
| Decode | `exact.evm.decodePayment()` | `@x402/evm` decoder |
| Version field | `x402Version: 1` | `x402Version: 2` |
| Facilitator | `useFacilitator()` | Modular facilitator client |
| Response header | `PaymentRequired` | `PAYMENT-REQUIRED` |

---

## Implementation Phases

### Phase 1: Dependencies & Config ✅ 
- [ ] Update `package.json` with v2 packages
- [ ] Run `bun install`
- [ ] Verify imports work

### Phase 2: Service Layer
- [ ] Rewrite `src/middleware/x402/service.ts`
  - [ ] Import from `@x402/core`, `@x402/evm`
  - [ ] Update `generatePaymentRequirement()` for v2 schema
  - [ ] Update `verifyPayment()` with v2 API
  - [ ] Update `settlePayment()` with v2 API

### Phase 3: Middleware
- [ ] Update `src/middleware/x402/middleware.ts`
  - [ ] Change header: `X-PAYMENT` → `PAYMENT-SIGNATURE`
  - [ ] Update 402 response format for v2
  - [ ] Change response header: `X-PAYMENT-RESPONSE` → `PAYMENT-RESPONSE`

### Phase 4: Routes
- [ ] Update `src/routes/x402/chat.ts`
  - [ ] Update `x402Version: 2` in responses
- [ ] Update `src/routes/x402/deep-research.ts`
  - [ ] Same changes as chat
- [ ] Update `src/routes/x402/index.ts`
  - [ ] Update config endpoint to reflect v2

### Phase 5: Testing
- [ ] Unit test payment encoding/decoding
- [ ] Integration test against facilitator
- [ ] End-to-end test with real payment ($0.01)

---

## Testing Strategy

### Potential Blockers

| Blocker | Risk | Mitigation |
|---------|------|------------|
| **Mainnet only** | Wallet has mainnet USDC | Use small amounts ($0.01-0.025) |
| **Gas fees** | Need ETH for tx | Wallet has 0.005 ETH - sufficient |
| **Facilitator** | May be unavailable | Test against x402.org and CDP |
| **Bun compatibility** | SDK may have Node code | Test early, polyfill if needed |

### Test Sequence
1. Start BioAgents locally with x402 enabled
2. Call `/api/x402/config` - verify v2 schema
3. Call `/api/x402/chat` (GET) - verify 402 response format
4. Make real payment via `@x402/fetch` client
5. Verify settlement and response

---

## Environment Variables

```bash
# Required for x402 v2
X402_ENABLED=true
X402_ENVIRONMENT=mainnet  # or testnet
X402_PAYMENT_ADDRESS=0x...  # Your receiving address
X402_NETWORK=base
X402_FACILITATOR_URL=https://x402.org/facilitator

# For CDP facilitator (optional)
CDP_API_KEY_ID=xxx
CDP_API_KEY_SECRET=xxx
```

---

## V2 API Reference

### New Package Imports
```typescript
import { PaymentRequirements, PaymentPayload } from '@x402/core';
import { exact } from '@x402/evm';
```

### New Header Names
```typescript
// Request header with payment
const PAYMENT_HEADER = 'PAYMENT-SIGNATURE';  // was X-PAYMENT

// Response header after settlement
const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';  // was X-PAYMENT-RESPONSE

// 402 response header
const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';  // new in v2
```

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
| | | |
