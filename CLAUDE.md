# BioAgents AgentKit

AI-powered research assistant for bioscience literature and data analysis.

## Related Documentation

- [AUTH.md](documentation/docs/AUTH.md) - Authentication (JWT, x402/b402 payments)
- [SETUP.md](documentation/docs/SETUP.md) - Environment setup and LLM configuration
- [JOB_QUEUE.md](documentation/docs/JOB_QUEUE.md) - BullMQ queue system architecture
- [FILE_UPLOAD.md](documentation/docs/FILE_UPLOAD.md) - S3 presigned URL file upload flow

---

## Deep Research: The AI Scientist Framework

We are building the **BEST AI scientist framework**. Deep Research is the PRIMARY way to use this agent - it is more important than basic chat. The agent MUST behave like a real scientist: iterative, methodical, and hypothesis-driven.

### Philosophy & Mission

**IMPORTANT**: This system enables real scientific discovery through iterative human-AI collaboration. Every research cycle builds on accumulated knowledge - YOU MUST NEVER treat queries in isolation.

Core principles:

1. **Iterative Investigation** - Research unfolds across multiple cycles, each deepening understanding
2. **Human-in-the-Loop Steering** - Users guide the research direction at every iteration
3. **Persistent World State** - All discoveries, hypotheses, and insights accumulate across the conversation
4. **Evidence-Grounded Claims** - Every discovery links to supporting tasks and data

### The Iterative Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEEP RESEARCH CYCLE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ PLANNING │───▶│ EXECUTE  │───▶│HYPOTHESIS│───▶│REFLECTION│  │
│  │  Agent   │    │  Tasks   │    │  Agent   │    │  Agent   │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │                                               │         │
│       │              ┌──────────┐                     │         │
│       │              │DISCOVERY │◀────────────────────┘         │
│       │              │  Agent   │                               │
│       │              └────┬─────┘                               │
│       │                   │                                     │
│       ▼                   ▼                                     │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              WORLD STATE (Accumulated Knowledge)        │    │
│  │  • currentObjective  • keyInsights  • discoveries      │    │
│  │  • methodology       • hypothesis   • datasets         │    │
│  └────────────────────────────────────────────────────────┘    │
│       │                                                         │
│       ▼                                                         │
│  ┌──────────────────┐                                          │
│  │ HUMAN STEERING   │ ◀── User approves/redirects              │
│  └────────┬─────────┘                                          │
│           │                                                     │
│           └──────────────── NEXT CYCLE ─────────────────────▶  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Each cycle:

1. **Planning** - Decides WHAT tasks to run based on current state and user input
2. **Execution** - Runs LITERATURE and ANALYSIS tasks in parallel
3. **Hypothesis** - Synthesizes outputs into scientific claims
4. **Reflection** - Updates world state with insights, evolves objectives
5. **Discovery** - Identifies novel claims and links them to evidence
6. **Human Steering** - User reviews, approves, or redirects

### Mini-Agent Collaboration

| Agent          | Role                                             | State Updates                                                         |
| -------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| **Planning**   | Decides WHAT tasks to run, plans next iterations | Returns suggestions (no state mutation)                               |
| **Hypothesis** | Synthesizes task outputs into scientific claims  | `currentHypothesis`                                                   |
| **Reflection** | Extracts insights, evolves research objectives   | `currentObjective`, `keyInsights`, `methodology`, `conversationTitle` |
| **Discovery**  | Identifies novel claims with evidence links      | `discoveries[]`                                                       |

**IMPORTANT**: Each agent reads the world state but only updates specific fields. This prevents conflicts and maintains clear causality.

### External Services

**IMPORTANT**: LITERATURE and ANALYSIS tasks are executed by EXTERNAL services (OpenScholar, Edison, BioAgents API). This repository CANNOT control their execution - we can only consume their outputs.

YOU MUST:

- Handle external service outputs gracefully
- Extract maximum value from returned data
- Never crash the workflow due to external service failures
- Properly attribute evidence from external sources

### Behavioral Mandates

**YOU MUST follow these rules to build a world-class AI scientist:**

#### World State Management

- YOU MUST update the world state after every task completion
- YOU MUST NEVER lose accumulated discoveries
- YOU MUST maintain complete traceability: claims → evidence → tasks → jobIds

#### Human Steering

- The user's input ALWAYS overrides agent suggestions
- YOU MUST present clear next steps for user approval before execution
- NEVER proceed with major direction changes without user consent
- When the user provides feedback, incorporate it into the next planning cycle

#### Scientific Rigor

- Every discovery MUST link to supporting evidence (taskId, jobId)
- Novelty claims MUST be validated against literature
- Hypotheses MUST evolve based on new findings - they are not static
- Maintain DOI citations for all literature references

#### Iteration Quality

- Each cycle MUST build meaningfully on prior work
- NEVER treat a research query in isolation
- Summarize accumulated context - don't dump raw conversation history
- The world state should grow richer and more nuanced over time

#### Paper Generation

- When generating papers, ensure complete traceability from claims to source data
- Include all DOI-backed citations in the bibliography
- Link figures and artifacts to their source analysis tasks

---

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Web Framework**: Elysia (not Express or raw Bun.serve)
- **Database**: Supabase (PostgreSQL)
- **Job Queue**: BullMQ with Redis (optional)
- **Frontend**: Preact (bundled client in `client/dist/`)

## Commands

```bash
# Install dependencies
bun install

# Development (API server with hot reload)
bun run dev

# Production server
bun run start

# Worker process (when USE_JOB_QUEUE=true)
bun run worker
bun run worker:dev  # with hot reload

# Build frontend
bun run build:client
```

## Project Structure

```
src/
├── index.ts              # Main server entry point (Elysia app)
├── worker.ts             # BullMQ worker entry point (separate process)
├── routes/               # API route handlers
│   ├── chat.ts          # POST /api/chat
│   ├── auth.ts          # /api/auth/* endpoints
│   ├── artifacts.ts     # /api/artifacts/download
│   ├── deep-research/   # /api/deep-research/*
│   ├── x402/            # Payment-gated routes (Base/USDC)
│   ├── b402/            # Payment-gated routes (BNB/USDT)
│   └── admin/           # Bull Board dashboard
├── agents/               # AI agent implementations
│   ├── literature/      # Literature search (OpenScholar, BioAgents, Edison)
│   ├── analysis/        # Data analysis agents
│   ├── hypothesis/      # Hypothesis generation
│   ├── planning/        # Research planning
│   ├── reflection/      # Self-reflection/critique
│   └── reply/           # Response generation
├── services/             # Business logic layer
│   ├── chat/            # Chat-related services
│   ├── queue/           # BullMQ job queue
│   │   ├── connection.ts    # Redis connection management
│   │   ├── queues.ts        # Queue definitions (chat, deep-research)
│   │   ├── workers/         # Worker implementations
│   │   └── notify.ts        # Redis pub/sub notifications
│   ├── websocket/       # WebSocket handler for real-time updates
│   └── jwt.ts           # JWT verification service
├── middleware/           # Auth, rate limiting, payment validation
│   ├── authResolver.ts  # Multi-method authentication
│   ├── rateLimiter.ts   # Rate limiting
│   ├── x402/            # x402 payment protocol (Base/USDC)
│   └── b402/            # b402 payment protocol (BNB/USDT)
├── llm/                  # LLM provider adapters
│   └── adapters/        # OpenAI, Anthropic, Google, OpenRouter
├── embeddings/           # Vector search and document processing
├── db/                   # Database operations (Supabase)
├── storage/              # File storage (S3)
├── types/                # TypeScript types
└── utils/                # Helpers (logger, cache, polyfills)
```

## Running Modes

### In-Process Mode (Default)

```bash
USE_JOB_QUEUE=false bun run dev
```

Jobs execute directly in the main process. Simpler for development.

### Queue Mode (Production)

```bash
# Terminal 1: API server
USE_JOB_QUEUE=true bun run dev

# Terminal 2: Worker process
USE_JOB_QUEUE=true bun run worker
```

Jobs are queued in Redis and processed by separate worker processes. Supports horizontal scaling.

## Key Environment Variables

See `.env.example` for full list. Critical ones:

```bash
# Authentication
BIOAGENTS_SECRET=          # JWT signing key
AUTH_MODE=none             # 'none' or 'jwt'

# LLM Providers
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Database
SUPABASE_URL=
SUPABASE_ANON_KEY=

# Job Queue (optional)
USE_JOB_QUEUE=false        # Enable BullMQ
REDIS_URL=redis://localhost:6379

# Payment Protocols (optional)
X402_ENABLED=false         # Base/USDC payments
B402_ENABLED=false         # BNB/USDT payments
```

## API Endpoints

### Core

- `POST /api/chat` - Chat with AI agent
- `POST /api/deep-research/start` - Start deep research job
- `GET /api/deep-research/status/:messageId` - Check job status
- `GET /api/health` - Health check with queue status

### Paper Generation

- `POST /api/deep-research/conversations/:conversationId/paper` - Generate LaTeX paper from conversation
- `GET /api/deep-research/paper/:paperId` - Get paper with fresh presigned URLs
- `GET /api/deep-research/conversations/:conversationId/papers` - List all papers for a conversation

### Payment-Gated (x402/b402)

- `POST /api/x402/chat` - Payment-gated chat (Base/USDC)
- `POST /api/b402/chat` - Payment-gated chat (BNB/USDT)

### Admin

- `/admin/queues` - Bull Board dashboard (when queue enabled)

## Bun-Specific Guidelines

- Use `bun <file>` instead of `node` or `ts-node`
- Use `bun test` instead of jest/vitest
- Use `bun install` instead of npm/yarn/pnpm
- Bun auto-loads `.env` files - no dotenv needed
- Use `Bun.file()` over `fs.readFile/writeFile`

## Known Issues

### TDZ (Temporal Dead Zone) in Worker Processes

Bun workers have different module initialization than the main process. Module-level variables can cause TDZ errors.

**Bad** (causes TDZ in workers):

```typescript
const config = process.env.MY_VAR; // TDZ error
let cache: Map<string, any>; // TDZ error

export function doSomething() {
  return config;
}
```

**Good** (use dynamic imports and globalThis):

```typescript
// No module-level variables!

export async function doSomething() {
  const config = process.env.MY_VAR; // Inside function

  // Use globalThis for singletons
  let cache = (globalThis as any).__myCache;
  if (!cache) {
    cache = new Map();
    (globalThis as any).__myCache = cache;
  }

  return config;
}
```

### Canvas Polyfill

`pdf-parse` requires canvas polyfills in server environments. Both `index.ts` and `worker.ts` must import the polyfill first:

```typescript
// Must be first line in entry files
import "./utils/canvas-polyfill";
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/path/to/test.ts

# Run tests with x402 enabled
X402_ENABLED=true bun test
```

## Docker Deployment

### Production (with Job Queue)

```bash
# Start all services (API + Worker + Redis)
docker compose up -d

# Scale workers horizontally
docker compose up -d --scale worker=3

# View logs
docker compose logs -f bioagents
docker compose logs -f worker

# Stop all services
docker compose down
```

Architecture:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│  API Server │────▶│    Redis    │
└─────────────┘     │  (bioagents)│     │   (queue)   │
                    └─────────────┘     └──────┬──────┘
                           │                   │
                           │ WebSocket         │ Jobs
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │   Client    │     │   Worker    │
                    │ (real-time) │     │ (1 or more) │
                    └─────────────┘     └─────────────┘
```

### Simple (without Queue)

```bash
# Single container, in-process mode
docker compose -f docker-compose.simple.yml up -d
```

### Environment Variables

Set in `.env` file or pass directly:

```bash
# Required for queue mode
USE_JOB_QUEUE=true

# Redis is auto-configured in docker-compose.yml
# Override only if using external Redis:
# REDIS_URL=redis://your-redis-host:6379
```

### Coolify/PaaS Deployment

For Coolify or similar PaaS:

1. Deploy the main `docker-compose.yml`
2. Set `USE_JOB_QUEUE=true` in environment
3. Redis is included as a service
4. Worker auto-scales based on `--scale worker=N`

## Development Tips

1. **Hot Reload**: Use `bun --watch` for auto-restart on changes
2. **Logging**: Check `pino` logs for structured logging output
3. **Queue Dashboard**: Access `/admin/queues` when `USE_JOB_QUEUE=true`
4. **WebSocket Testing**: Connect to `/ws?userId=<uuid>` for real-time job updates

## Other repositories related to this project

IMPORTANT:

- To get details about other related repositories to this project, feel free to check out the ~/.claude/CLAUDE.md from the main CLAUDE.md. There you will find information about the data analysis and literature agent implementations, as well as the production frontend for our repository (not the dev one that is found here).
