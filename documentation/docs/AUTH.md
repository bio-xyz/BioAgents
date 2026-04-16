# Authentication Guide

BioAgents supports JWT authentication for external frontends.

| Setting | Options | Purpose |
|---------|---------|---------|
| `AUTH_MODE` | `none` / `jwt` | JWT authentication for external frontends |

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

## API Endpoints

| Endpoint | Auth Required |
|----------|--------------|
| `/api/chat` | JWT (if `AUTH_MODE=jwt`) |
| `/api/deep-research/start` | JWT (if `AUTH_MODE=jwt`) |
| `/api/deep-research/status` | JWT (if `AUTH_MODE=jwt`) |
| `/api/health` | No |

---

## Implementation Files

| File | Purpose |
|------|---------|
| `src/middleware/authResolver.ts` | Unified auth middleware |
| `src/services/jwt.ts` | JWT verification |
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
