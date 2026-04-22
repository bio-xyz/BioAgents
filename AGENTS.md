# BioAgents AgentKit — AI-powered bioscience research assistant

## Core Principles

See `CODING_GUIDELINES.md` for general principles. Additionally:

- State assumptions explicitly before coding; ask if uncertain
- Minimum code solving the problem; nothing speculative
- Touch only what you must; preserve adjacent style
- Verify with tests/typecheck before considering done

## Commands

**MANDATORY after edits:**
```bash
bun typecheck && bun test
```

**Do NOT run `bun style:write` manually.** Husky runs Biome automatically on staged files during commit (pre-commit hook). This keeps formatting incremental — only touched files get fixed.

Other commands:
- `bun dev` — API server with hot reload
- `bun start` — Production server
- `bun worker` / `bun worker:dev` — BullMQ worker process
- `bun lint` / `bun lint:fix` — Biome lint
- `bun format:check` / `bun format:write` — Biome format
- `bun style:check` / `bun style:write` — Biome lint + format + import sorting (prefer pre-commit hook)
- `bun typecheck` — TypeScript type checking
- `bun test` — bun:test
- `bun build:client` — Build Preact frontend

## Tech Stack

- **Runtime**: Bun (not Node.js) — use `bun` everywhere, not `node`/`npm`/`ts-node`
- **Web Framework**: Elysia
- **Database**: Supabase (PostgreSQL)
- **Job Queue**: BullMQ with Redis (optional, `USE_JOB_QUEUE=true`)
- **Frontend**: Preact (bundled client in `client/dist/`)
- **Testing**: bun:test

## Project Structure

```
src/
├── index.ts              # Main server entry (Elysia app)
├── worker.ts             # BullMQ worker entry (separate process)
├── character.ts          # Agent identity/persona
├── routes/
│   ├── chat.ts           # POST /api/chat, GET /api/chat/status/:jobId
│   ├── auth.ts           # /api/auth/* (login, logout, status)
│   ├── artifacts.ts      # GET /api/artifacts/download
│   ├── clarification.ts  # /api/clarification/* (pre-research flow)
│   ├── files.ts          # /api/files/* (upload, confirm, status, delete)
│   ├── deep-research/    # /api/deep-research/* (start, status, branch, paper)
│   ├── x402/             # Payment-gated routes (Base/USDC)
│   ├── b402/             # Payment-gated routes (BNB/USDT)
│   └── admin/            # Bull Board dashboard + job management
├── agents/
│   ├── analysis/         # Data analysis (Edison, BioData)
│   ├── clarification/    # Pre-research question generation & plan creation
│   ├── continueResearch/ # Autonomy decision (continue vs ask user)
│   ├── discovery/        # Structure scientific discoveries from task results
│   ├── fileUpload/       # File parsing (PDF, Excel, CSV, MD, JSON, TXT, OCR)
│   ├── hypothesis/       # Hypothesis generation/updates from task outputs
│   ├── literature/       # Literature search (OpenScholar, Knowledge, Edison, BioLit)
│   ├── planning/         # Research plan/task generation
│   ├── reflection/       # World state updates (objective, insights, methodology)
│   └── reply/            # User-facing response generation
├── chat-agent/           # Shared chat agent runtime (Claude Sonnet + tool use)
│   ├── runner.ts         # Main execution loop (in-process + queue modes)
│   ├── loop.ts           # Recursive message loop with tool execution
│   ├── registry.ts       # Tool registration
│   └── tools/            # Chat agent tools (literature-search)
├── services/
│   ├── chat/             # Conversation setup, message tools, payments
│   ├── deep-research/    # Deep research mode guard/validation
│   ├── files/            # File upload URL generation, processing, status
│   ├── paper/            # Paper generation (Markdown → Pandoc → LaTeX → PDF)
│   ├── queue/            # BullMQ connection, queues, workers, notifications
│   └── websocket/        # WebSocket handler, Redis pub/sub
├── middleware/
│   ├── authResolver.ts   # Multi-method auth (JWT, API key, x402, b402)
│   ├── rateLimiter.ts    # Redis-backed rate limiting
│   ├── x402/             # x402 payment validation (Base/USDC)
│   └── b402/             # b402 payment validation (BNB/USDT)
├── llm/                  # LLM provider adapters (OpenAI, Anthropic, Google, OpenRouter)
├── embeddings/           # Vector search and document processing
├── mcp/                  # MCP server integration
├── db/                   # Database operations (Supabase)
├── storage/              # File storage (S3 with presigned URLs)
├── types/                # TypeScript types + Zod schemas
└── utils/                # Helpers (logger, cache, UUID, state, polyfills)
```

## Running Modes

### In-Process (Default)
```bash
USE_JOB_QUEUE=false bun run dev
```
Jobs execute in the main process. Simpler for development.

### Queue Mode (Production)
```bash
# Terminal 1: API server
USE_JOB_QUEUE=true bun run dev

# Terminal 2: Worker
USE_JOB_QUEUE=true bun run worker:dev
```
Jobs queued in Redis, processed by separate workers. Supports horizontal scaling.

## Key Environment Variables

See `.env.example` for full list. Key groups:

- **Auth**: `BIOAGENTS_SECRET`, `AUTH_MODE` (none/jwt), `UI_PASSWORD`
- **LLM**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` + per-agent model config (`REPLY_LLM_PROVIDER`, `HYP_LLM_MODEL`, etc.)
- **Chat Agent**: `CHAT_AGENT_MODEL`, `CHAT_AGENT_MAX_TOOL_CALLS`, `CHAT_AGENT_MAX_TOKENS`
- **Database**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
- **Embeddings/RAG**: `EMBEDDING_PROVIDER`, `TEXT_EMBEDDING_MODEL`, `COHERE_API_KEY`, chunk/vector/reranking settings
- **External Services**: `EDISON_API_URL`, `OPENSCHOLAR_API_URL`, `BIO_LIT_AGENT_API_URL`
- **Storage**: `STORAGE_PROVIDER` (s3), `S3_BUCKET`, AWS credentials
- **Queue**: `USE_JOB_QUEUE`, `REDIS_URL`, concurrency + rate limit settings
- **Payments**: `X402_ENABLED`, `B402_ENABLED` + CDP credentials

## API Endpoints

### Core
- `POST /api/chat` — Chat with AI agent
- `GET /api/chat/status/:jobId` — Check chat job status (queue mode)
- `POST /api/deep-research/start` — Start deep research session
- `GET /api/deep-research/status/:messageId` — Check research status
- `POST /api/deep-research/branch` — Fork research conversation
- `GET /api/health` — Health check

### Clarification (Pre-Research)
- `POST /api/clarification/generate-questions` — Generate clarification questions
- `POST /api/clarification/submit-answers` — Submit answers, create plan
- `POST /api/clarification/plan-feedback` — Feedback on generated plan
- `GET /api/clarification/:sessionId` — Get session state

### Files
- `POST /api/files/upload-url` — Request presigned upload URL
- `POST /api/files/confirm` — Confirm upload, start processing
- `GET /api/files/:fileId/status` — Processing status
- `DELETE /api/files/:fileId` — Delete file

### Paper Generation
- `POST /api/deep-research/conversations/:conversationId/paper` — Generate paper
- `GET /api/deep-research/paper/:paperId` — Get paper with presigned URLs
- `GET /api/deep-research/conversations/:conversationId/papers` — List papers

### Payment-Gated
- `POST /api/x402/chat` — Chat via Base/USDC
- `POST /api/b402/chat` — Chat via BNB/USDT

### Admin
- `/admin/queues` — Bull Board dashboard (when queue enabled)

## Docker Deployment

### Production (with Job Queue)
```bash
docker compose up -d                    # API + Worker + Redis
docker compose up -d --scale worker=3   # Scale workers
```

### Worker-Only
```bash
docker compose -f docker-compose.worker.yml up -d
```

### Swarm Mode
```bash
docker compose -f docker-compose.swarm.yml ...
```

---

## Deep Research: The AI Scientist Framework

Deep Research is the PRIMARY way to use this agent. The agent behaves like a real scientist: iterative, methodical, hypothesis-driven.

### Iterative Workflow

```
Planning → Execute Tasks → Hypothesis → Reflection → Discovery → Human Steering → Next Cycle
```

Each cycle:
1. **Planning** — Decides WHAT tasks to run based on current state + user input
2. **Execution** — Runs LITERATURE and ANALYSIS tasks in parallel (external services)
3. **Hypothesis** — Synthesizes outputs into scientific claims
4. **Reflection** — Updates world state with insights, evolves objectives
5. **Discovery** — Identifies novel claims, links to evidence
6. **Human Steering** — User reviews, approves, or redirects

### Mini-Agent State Ownership

| Agent | Updates |
|-------|---------|
| Planning | Returns suggestions (no state mutation) |
| Hypothesis | `currentHypothesis` |
| Reflection | `currentObjective`, `keyInsights`, `methodology`, `conversationTitle` |
| Discovery | `discoveries[]` |

### Behavioral Mandates

- Update world state after every task completion — NEVER lose accumulated discoveries
- Maintain traceability: claims → evidence → tasks → jobIds
- User input ALWAYS overrides agent suggestions
- Present clear next steps for user approval before execution
- Every discovery MUST link to supporting evidence (taskId, jobId)
- Each cycle MUST build meaningfully on prior work
- LITERATURE and ANALYSIS tasks are executed by EXTERNAL services — handle failures gracefully

## Known Issues

### TDZ (Temporal Dead Zone) in Workers

Bun workers have different module initialization. Module-level variables cause TDZ errors.

```typescript
// BAD — TDZ error in workers
const config = process.env.MY_VAR;

// GOOD — inside function
export async function doSomething() {
  const config = process.env.MY_VAR;
}

// GOOD — globalThis for singletons
let cache = (globalThis as any).__myCache;
if (!cache) {
  cache = new Map();
  (globalThis as any).__myCache = cache;
}
```

### Canvas Polyfill

`pdf-parse` requires canvas polyfills. Both `index.ts` and `worker.ts` MUST import the polyfill first:
```typescript
import "./utils/canvas-polyfill";
```

## Related Documentation

- [AUTH.md](documentation/docs/AUTH.md) — Authentication (JWT, x402/b402 payments)
- [SETUP.md](documentation/docs/SETUP.md) — Environment setup and LLM configuration
- [JOB_QUEUE.md](documentation/docs/JOB_QUEUE.md) — BullMQ queue system architecture
- [FILE_UPLOAD.md](documentation/docs/FILE_UPLOAD.md) — S3 presigned URL file upload flow

## Git & PRs

- Branch naming: `[initials]-[description]` (e.g., `ms-add-basic-code-quality`)
- Biome lint/format and tests run in CI — do NOT include as manual test plan items
- PR test plan: only manual verification steps
