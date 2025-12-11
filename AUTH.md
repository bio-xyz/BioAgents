# Authentication Guide

BioAgents supports two independent authentication systems:

| Setting | Options | Purpose |
|---------|---------|---------|
| `AUTH_MODE` | `none` / `jwt` | JWT authentication for external frontends |
| `X402_ENABLED` | `true` / `false` | x402 USDC micropayments |

## Quick Start

### Development (No Auth)

```bash
AUTH_MODE=none
```

### Production (JWT Auth)

```bash
AUTH_MODE=jwt
BIOAGENTS_SECRET=your-secure-secret  # openssl rand -hex 32
```

### Pay-per-Request (x402)

```bash
X402_ENABLED=true
X402_ENVIRONMENT=testnet
X402_PAYMENT_ADDRESS=0xYourWalletAddress
```

---

## JWT Authentication

For external frontends connecting to the API. Your backend authenticates users and signs JWTs with a shared secret.

### Configuration

```bash
AUTH_MODE=jwt
BIOAGENTS_SECRET=your-secure-secret  # Generate with: openssl rand -hex 32
MAX_JWT_EXPIRATION=3600              # 1 hour max (optional)
```

### How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────>│ Your Backend │────>│  BioAgents   │
│              │     │              │     │     API      │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │  1. User logs in   │                    │
       │  ───────────────>  │                    │
       │                    │                    │
       │  2. Create JWT     │                    │
       │  with userId (sub) │                    │
       │                    │                    │
       │  3. Return JWT     │                    │
       │  <───────────────  │                    │
       │                    │                    │
       │  4. Call API with JWT                   │
       │  ─────────────────────────────────────> │
       │                    │                    │
       │  5. Verify JWT, extract userId          │
       │  <───────────────────────────────────── │
```

### JWT Payload

```typescript
{
  sub: string;    // REQUIRED: User ID (must be valid UUID)
  exp: number;    // REQUIRED: Expiration timestamp
  iat: number;    // REQUIRED: Issued at timestamp
  email?: string; // Optional
  orgId?: string; // Optional: For multi-tenant deployments
}
```

### Code Examples

#### Node.js / TypeScript (jose)

```typescript
import * as jose from 'jose';

const secret = new TextEncoder().encode(process.env.BIOAGENTS_SECRET);

const jwt = await new jose.SignJWT({
  sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'  // Must be UUID
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(secret);

// Call BioAgents API
const response = await fetch('https://your-bioagents-api/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message: 'What is rapamycin?' })
});
```

#### Node.js (jsonwebtoken)

```typescript
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
  process.env.BIOAGENTS_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' }
);
```

#### Python (PyJWT)

```python
import jwt
import os
from datetime import datetime, timedelta

token = jwt.encode(
    {
        'sub': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'exp': datetime.utcnow() + timedelta(hours=1),
        'iat': datetime.utcnow()
    },
    os.environ['BIOAGENTS_SECRET'],
    algorithm='HS256'
)
```

### Important Notes

- **`sub` must be a valid UUID** - The database requires UUID format. Generate with `crypto.randomUUID()` or equivalent
- **Never expose `BIOAGENTS_SECRET`** - Generate JWTs server-side only
- **Use short expiration** - 1 hour recommended, max configurable via `MAX_JWT_EXPIRATION`
- **Same user = same UUID** - Use consistent UUIDs per user to maintain conversation history

---

## x402 Payment Protocol

For pay-per-request access using USDC micropayments on Base network.

### Features

- **Gasless Transfers**: EIP-3009 for fee-free USDC transfers
- **Embedded Wallets**: Email-based wallet creation via CDP
- **HTTP 402 Flow**: Standard "Payment Required" protocol
- **Base Network**: Supports testnet (Base Sepolia) and mainnet (Base)
- **Persistent Conversations**: Multi-turn conversations supported

### Configuration

```bash
X402_ENABLED=true
X402_PAYMENT_ADDRESS=0xYourWalletAddress
X402_ENVIRONMENT=testnet  # or 'mainnet'
X402_NETWORK=base-sepolia  # or 'base' for mainnet
X402_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

### Coinbase CDP Credentials

Get from [Coinbase Developer Portal](https://portal.cdp.coinbase.com):

```bash
CDP_API_KEY_ID=your_key_id
CDP_API_KEY_SECRET=your_key_secret
CDP_PROJECT_ID=your_project_id  # For embedded wallets
```

### How It Works

```
Client                          Server
  |                               |
  |-- POST /api/x402/chat ------->|
  |                               |
  |<-- 402 Payment Required ------|
  |    (payment details)          |
  |                               |
  |-- Sign USDC authorization --->|
  |    (gasless EIP-3009)         |
  |                               |
  |-- POST /api/x402/chat ------->|
  |    + X-PAYMENT header         |
  |                               |
  |<-- 200 OK + response ---------|
```

### Code Example

```javascript
import { x402Fetch } from 'x402-fetch';

const response = await x402Fetch('http://localhost:3000/api/x402/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'What is DNA?',
    conversationId: 'test-conv-123'  // Optional: for multi-turn
  }),
  x402: {
    privateKey: process.env.WALLET_PRIVATE_KEY,
    network: 'base-sepolia'
  }
});
```

### Pricing

Default: $0.01 per request. Configure in `src/x402/pricing.ts`:

```typescript
export const routePricing: RoutePricing[] = [
  {
    route: "/api/x402/chat",
    priceUSD: "0.01",
    description: "Chat API access",
  },
];
```

---

## Authentication Priority

When multiple auth methods are available, the system uses this priority:

1. **x402 payment proof** - Cryptographic wallet signature (highest trust)
2. **JWT token** - Verified signature
3. **Anonymous** - Only if `AUTH_MODE=none`

---

## Combining JWT + x402

You can enable both systems simultaneously:

```bash
AUTH_MODE=jwt
X402_ENABLED=true
```

This allows:
- JWT-authenticated users to access `/api/chat` and `/api/deep-research/*` (no payment)
- Anyone to pay-per-request via `/api/x402/chat` and `/api/x402/deep-research/*`

When x402 payment is present, it takes priority over JWT authentication.

---

## API Endpoints

| Endpoint | Auth Required | Payment Required |
|----------|--------------|------------------|
| `/api/chat` | JWT (if `AUTH_MODE=jwt`) | No |
| `/api/x402/chat` | No | Yes (x402) |
| `/api/deep-research/start` | JWT (if `AUTH_MODE=jwt`) | No |
| `/api/deep-research/status` | JWT (if `AUTH_MODE=jwt`) | No |
| `/api/x402/deep-research/start` | No | Yes (x402) |
| `/api/x402/deep-research/status` | No | Yes (x402) |
| `/api/x402/config` | No | No |
| `/api/health` | No | No |

---

## Database Schema

### Payment Tracking - `x402_payments`

```sql
CREATE TABLE x402_payments (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),
  message_id UUID REFERENCES messages(id),
  amount_usd NUMERIC NOT NULL,
  amount_wei TEXT NOT NULL,
  asset TEXT DEFAULT 'USDC',
  network TEXT NOT NULL,
  tools_used TEXT[],
  tx_hash TEXT,
  payment_status TEXT CHECK (payment_status IN ('pending', 'verified', 'settled', 'failed')),
  payment_header JSONB,
  payment_requirements JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ
);
```

---

## Implementation Files

| File | Purpose |
|------|---------|
| `src/middleware/authResolver.ts` | Unified auth middleware |
| `src/services/jwt.ts` | JWT verification |
| `src/middleware/x402.ts` | Payment enforcement |
| `src/x402/service.ts` | Payment verification |
| `src/types/auth.ts` | Auth types |

---

## Troubleshooting

### JWT Authentication Failed

**Issue**: 401 Unauthorized

**Solutions**:
- Verify `BIOAGENTS_SECRET` matches on both sides
- Check JWT expiration (max 1 hour by default)
- Ensure `sub` claim is a valid UUID
- Verify `AUTH_MODE=jwt` is set on server

### Payment Verification Failed

**Issue**: `x402_payment_invalid` error

**Solutions**:
- Check USDC balance in wallet
- Verify network configuration (testnet vs mainnet)
- Ensure facilitator URL is correct

### x402 Routes Not Available

**Issue**: 404 on `/api/x402/*` routes

**Solutions**:
- Verify `X402_ENABLED=true` is set
- Restart server after changing `.env`

---

## Resources

- [x402 Protocol](https://x402.org)
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com)
- [Base Network](https://base.org)
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)
