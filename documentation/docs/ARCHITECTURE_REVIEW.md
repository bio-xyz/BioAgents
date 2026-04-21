# BIOS Backend Architecture Review

## Executive summary

BIOS is a Bun + Elysia monolith that serves an AI researcher product: a chat agent and an iterative "deep research" pipeline built on OpenScholar/Edison/BioAgents external services, OpenAI/Anthropic/Google LLMs, Supabase (Postgres + pgvector), BullMQ on Redis, and S3. Auth is headers-based (JWT + API key + x402 wallet signatures), which is the one area that is already well-aligned for CLI and native clients. Everything else is shaped around a web UI that lives in the same repo (`client/`) and is bundle-served from the backend.

Shape: **usable, but fragile.** It ships, handles payments, runs jobs, and composes a real agent pipeline. But orchestration lives in 2000-line route handlers, there is no test suite or real CI, queue and in-process paths have forked copies of the same logic, several JSONB "god blobs" hold core state, and `src/db/setup.sql` has silently drifted from the real Supabase migrations.

Top concerns for the team transition: (1) the 2113-line `deep-research/start.ts` and its 1494-line worker twin are the single largest inheritance risk; (2) there is no test or type-check in CI, so any onboarding engineer is flying blind; (3) there is no streaming path anywhere, which will bite both new frontends; (4) `states.values` / `conversation_states.values` are unbounded JSONB dumping grounds that couple every agent to every other agent; (5) auth is good enough for CLI/macOS but the rest of the stack assumes batch JSON + same-origin web UI.

## Top findings (prioritized)

1. **`deep-research/start.ts` is a 2113-line route handler; its worker twin is 1494 lines.** Both contain the same orchestration (plan → literature+analysis → hypothesis → reflection → discovery → continue). `chatHandler` was extracted as a shared function (`src/routes/chat.ts:240`) and reused by x402/b402 chat routes; `deepResearchStartHandler` was not split the same way, and `src/routes/x402/deep-research.ts:31-80` then re-implements the status lookup by hand. **Impact**: any change to the research cycle has to be made in two places; new engineers cannot hold the flow in their head. **Recommendation**: extract a `services/deep-research/orchestrator.ts` with a pure `runResearchIteration(state, input) → {nextState, output, sideEffects}` function; make both the route and the worker ~80-line shells over it.

2. **No tests and no real CI.** `find src -name "*.test.ts"` returns nothing. `.github/workflows/deploy-worker.yml` only builds and pushes a Docker image; there is no `tsc --noEmit`, no lint, no unit tests. **Impact**: onboarding engineers have no safety net, and regressions will only be caught in production. **Recommendation**: add a CI job that runs `bun run tsc --noEmit`, `bun test`, and `prettier --check` on every PR before any refactor begins; even a handful of smoke tests around `chatHandler` and `runChatAgent` would be high leverage.

3. **Queue mode and in-process mode are forked code paths, not a shared core.** `chat.worker.ts` (676 lines) and `chat.ts`'s in-process branch (`src/routes/chat.ts:538-727`) re-do DB setup, agent invocation, and result persistence independently. Same for deep research. The chat-agent *runner* (`src/chat-agent/runner.ts`) is the only properly-shared piece. **Impact**: behavioral drift between dev (`USE_JOB_QUEUE=false`) and prod (`USE_JOB_QUEUE=true`) is likely. **Recommendation**: collapse to one path. If `USE_JOB_QUEUE=false`, enqueue and run the worker inline; do not keep two implementations.

4. **No streaming anywhere.** `grep -r "text/event-stream\|ReadableStream\|SSE" src/` returns nothing. Every response is batch JSON (`chat.ts:667-727`, `deep-research/start.ts` returns `{messageId, status: "queued"}`, WebSocket only broadcasts notify-then-fetch metadata, `services/websocket/handler.ts`). **Impact**: a CLI or native macOS app will display a spinner for 20-30 seconds per deep-research iteration with nothing to show. **Recommendation**: introduce SSE on `/api/chat` and on `/api/deep-research/stream/:messageId`. LLM adapters already return deltas upstream (`@anthropic-ai/sdk`, `openai`); plumb them through `runAgentLoop` with an optional `onDelta` callback.

5. **JSONB "god blobs" carry the real domain model.** `conversation_states.values` and `states.values` are untyped `JSONB NOT NULL DEFAULT '{}'` (`supabase/migrations/20251217123219_remote_schema.sql`, also `src/db/setup.sql:32-44`). Fields read out of them are strewn throughout agents and the deep-research worker (`src/db/operations.ts:522-575` shows seven distinct nested shapes being cleaned before persistence: `rawFiles`, `uploadedDatasets`, `plan[].datasets`, `plan[].artifacts`, `agentProgress`, `currentHypothesis`, `keyInsights`). There is no migration path if a field shape changes; nothing enforces invariants. **Impact**: cross-agent changes are risky because every agent reads and writes these blobs. **Recommendation**: start by defining a Zod schema for `ConversationStateValues` (the interface already exists in `src/types/core.ts`) and validating on write in `updateConversationState`. Promote the two or three most-used fields (`plan`, `discoveries`, `uploadedDatasets`) to proper columns over time.

6. **`src/db/setup.sql` has silently drifted from the real schema.** It drops and re-creates tables (`setup.sql:8-11`) and is missing `paper`, `token_usage`, `clarification_sessions`, `conversations.parent_conversation_id`, `messages.clean_content`/`summary`/`citation_metadata`, `documents` (pgvector), `follow_up_suggestions`, `hypotheses`, `invites`, `product_generations`, `shared_conversations`. The authoritative schema is `supabase/migrations/20251217123219_remote_schema.sql` (76 KB). **Impact**: a new engineer running "the setup SQL" gets a half-initialised DB. **Recommendation**: delete `src/db/setup.sql` and point the README exclusively at `supabase migration up`. Add a migration-drift check to CI.

7. **RLS is off on base tables; the only protection is that every DB call goes through authed routes.** `getServiceClient()` uses the service-role key (`src/db/client.ts`, `src/db/operations.ts:7`: "bypass RLS - auth is verified by middleware"). All 20 call sites of `supabase.from()` across `src/db/` are fine, but several routes also reach directly into Supabase (e.g. `src/routes/deep-research/paper.ts:503` does `supabase.from("paper").insert(...)`). **Impact**: a single route that skips `authResolver` or accepts a caller-supplied `userId` without verifying ownership leaks all other users' data. `ensureUserAndConversation` (`src/services/chat/setup.ts:55-78`) does check ownership; it is not clear every route does. **Recommendation**: enable RLS on at least `conversations`, `messages`, and the two `_states` tables with a policy keyed off a JWT claim, even if the service role bypasses it in practice — it becomes a defense-in-depth net.

8. **The `/api/auth/login` flow is not really multi-user.** `src/routes/auth.ts:38-42` returns a **hardcoded UUID** (`550e8400-e29b-41d4-a716-446655440000`) for every UI login, and a single shared `UI_PASSWORD` gates access. This is an explicit comment: "in a real system, you'd have actual user accounts." **Impact**: the "web UI" user model is effectively single-tenant; every conversation from the web bundles under one user id. The backend already supports real multi-user flows via JWT `sub` and x402 wallets, so the gap is entirely on the login route. **Recommendation**: before a CLI or macOS app ships, decide whether login is (a) external IdP → signed JWT, (b) wallet-based, or (c) a real email/password table; the current "one password, one uuid" shim will not extend.

9. **Admin dashboard (`/admin/queues`) is unprotected unless `ADMIN_PASSWORD` is explicitly set, and the code warns only in logs.** `src/index.ts:289-327` mounts Bull Board and conditionally wraps it in basic auth. If `ADMIN_PASSWORD` is empty (the default in `.env.example`), the dashboard ships open. **Impact**: anyone who can reach the host can read job payloads containing the user prompt and `messageId`. **Recommendation**: refuse to start, or refuse to mount the dashboard, when `NODE_ENV=production` and `ADMIN_PASSWORD` is unset.

10. **Rate limiter silently no-ops when `USE_JOB_QUEUE=false`.** `src/middleware/rateLimiter.ts:62-68, 191-193` bails out without limiting when the queue is disabled. **Impact**: a dev who toggles the flag for local debugging turns off abuse protection without noticing. **Recommendation**: back the limiter with an in-memory fallback (or a small sidecar) so rate limits apply regardless of queue mode; at minimum, log a warning on startup in production.

## Repository structure

### What's there

Top level is idiomatic for a Bun/Elysia monolith: `src/`, `client/` (Preact SPA bundled into the same deploy), `supabase/migrations/`, `docs/`, `documentation/`, three `docker-compose*.yml` variants, a single `Dockerfile`. `src/` breaks into `routes/`, `services/`, `agents/`, `middleware/`, `llm/`, `embeddings/`, `storage/`, `db/`, `chat-agent/`, `types/`, `utils/`, plus two entry points (`index.ts`, `worker.ts`). The chat agent loop has its own sub-tree in `src/chat-agent/` (runner, loop, registry, tools) and is the only cleanly factored abstraction that is shared between the in-process and worker code paths.

### Assessment

Nominal layering is fine — `routes → services → db/agents` — but **routes carry orchestration**, not wiring. `src/routes/chat.ts` is 745 lines; `src/routes/deep-research/start.ts` is 2113; `src/routes/deep-research/paper.ts` is 677; `src/routes/clarification.ts` is 531. The "service" layer under `src/services/chat/` is thin (only `setup.ts`, `tools.ts`, `payment.ts`, totalling ~350 lines); there is no `services/deep-research/*.ts` at all — deep research has a folder but the folder contents are workers and helpers, not a service. The chat agent runner (`src/chat-agent/runner.ts`) is the one well-factored seam and demonstrably proves that extraction is tractable.

Cross-cutting issues: **dynamic imports inside async functions** are used pervasively (`src/chat-agent/runner.ts:78-82`, `src/routes/chat.ts:79, 89, 456, 485, 612, 678`, etc.). `CLAUDE.md` explains this as a Bun-worker TDZ workaround, which is legitimate, but it also hides the dependency graph from tools and reviewers. `src/agents/` has a `mcp/` directory and a `clarification/`, `continueResearch/`, `fileUpload/`, etc. — ten subfolders that each follow a slightly different internal convention. Naming is inconsistent: `chat-agent/` is kebab-case; sibling `agents/*` are all camelCase.

**Dead / drift**: `src/db/setup.sql` is drifted from the live schema (finding #6). `src/character.ts` (not read in detail) appears to be an ElizaOS/persona artefact of ambiguous current use.

### Recommendations

1. Extract `src/services/deep-research/orchestrator.ts` and move everything from `routes/deep-research/start.ts` except request parsing, auth plumbing, and HTTP response formatting.
2. Collapse the four-worker model (chat, deep-research, file-process, paper-generation) into a shared worker scaffold; right now each has its own retry/heartbeat/notify setup.
3. Delete `src/db/setup.sql` and reference `supabase/migrations/` as the only source of truth.
4. Pick one casing (`kebab-case` for directories is the most common). Move `chat-agent/` under `agents/chat/` for symmetry, or move the rest to kebab-case.
5. Stop putting handler bodies in `routes/`. The norm should be: a route file under 150 lines, a service file doing the orchestration.

## Deployment & runtime requirements

### What's there

Single `Dockerfile` (Bun base image + LaTeX + pandoc + Supabase CLI, ~1.5-2 GB image). Three compose files: `docker-compose.yml` (API + Redis + migrate one-shot), `docker-compose.worker.yml` (standalone worker with 8h drain grace, resource limits, scale), `docker-compose.swarm.yml` (zero-downtime rolling updates under Swarm, pinned to `biosagent/bios:latest`). Entry points are `bun src/index.ts` and `bun src/worker.ts`. CI is a single workflow: `.github/workflows/deploy-worker.yml` builds and pushes the Docker image to Docker Hub and pings a Portainer webhook. There is no test, lint, type-check, or security-scan step. Environment config is via `.env`/`.env.worker`; `.env.example` has ~90 variables.

### Assessment

Runtime shape is reasonable but has ops sharp edges. The Dockerfile is big because `pdf-parse` requires a canvas polyfill and paper generation requires LaTeX+pandoc in-process; consider isolating paper generation into its own image so the API container can shrink. `docker-compose.yml:158-170` runs Redis with `--maxmemory 512mb --maxmemory-policy noeviction`, which means Redis hard-errors on OOM instead of evicting; for BullMQ that manifests as job enqueues silently failing. The swarm compose pins `:latest` (`docker-compose.swarm.yml`), which defeats rolling-update safety — a redeploy can pick up a different image than the one you just tested.

**CI gap** is severe. No `tsc --noEmit`, no unit tests, no lint. Combined with the dynamic-import pattern (which hides compile errors until the specific code path runs), this is a real risk.

**Secrets posture**: `.env.example` has `BIOAGENTS_SECRET=change-me-...` as its default and `AUTH_MODE=none` as its default. `src/index.ts:49-56` warns in logs if `ALLOWED_ORIGINS` is unset in production but does not refuse to start. `ADMIN_PASSWORD` defaults empty (see finding #9). `UI_PASSWORD` is a single shared secret for the UI.

Graceful shutdown is implemented on both processes (`src/index.ts:444-476`, `src/worker.ts:43-67`) and does close Redis connections, which is good. Healthchecks exist on the API (`/api/health` with Redis ping) and Redis (`redis-cli ping`); the worker healthcheck referenced in the compose files is `pgrep -f worker` which does not actually verify the worker is consuming jobs.

### Recommendations

1. Add CI: `tsc --noEmit`, `prettier --check`, `bun test`, plus at least a Trivy image scan.
2. Replace `:latest` tags in `docker-compose.swarm.yml` with the commit SHA that the build workflow already produces and pushes.
3. Change Redis to `maxmemory-policy allkeys-lru` (BullMQ keys are not eternal; losing old completed jobs is fine).
4. Move paper generation (LaTeX + pandoc, ~1 GB of layers) into a separate worker image; the API server does not need `texlive` on disk.
5. Fail-closed on missing secrets in production: empty `BIOAGENTS_SECRET`, empty `ALLOWED_ORIGINS`, or empty `ADMIN_PASSWORD` with `NODE_ENV=production` should refuse to boot.
6. Replace `pgrep` worker healthcheck with an HTTP endpoint on the worker process or a BullMQ `isPaused` check.

## Persistence layers

### What's there

- **Postgres (Supabase)** — 6 migrations covering 18 tables. Core: `users`, `conversations`, `messages`, `states`, `conversation_states`, `documents` (with `embedding vector(1536)`, HNSW cosine index, pgvector `match_documents` fn). Product extensions: `paper`, `token_usage`, `clarification_sessions`, `x402_payments`, `x402_external`, `follow_up_suggestions`, `hypotheses`, `invites`, `product_generations`, `shared_conversations`. RLS enabled on `token_usage` and `clarification_sessions` with permissive "allow all" policies; RLS off on the base tables.
- **Redis (BullMQ)** — four queues: `chat`, `deep-research`, `file-process`, `paper-generation`, each with its own retention and retry policy (`src/services/queue/queues.ts`). Also used for (a) rate limiting via sliding-window sorted sets (`src/middleware/rateLimiter.ts`), (b) Redis pub/sub for WebSocket notifications (`src/services/queue/notify.ts` → `src/services/websocket/subscribe.ts`). Three separate `ioredis` connections are held open because BullMQ requires `maxRetriesPerRequest: null` and pub/sub needs its own connection.
- **S3 (or S3-compatible)** — `src/storage/` has a `StorageProvider` abstract class, one `S3StorageProvider` implementation, a factory + singleton, and supports DO/R2 via `S3_ENDPOINT`. Used for paper PDFs (`papers/{paperId}/paper.pdf`) and user uploads (`user/{userId}/conversation/{conversationId}/uploads/{filename}`). Signed URLs issued on demand, 3600s default.
- **Filesystem** — `characters/`, `docs/`, `client/dist/` are mounted as volumes in compose.
- **No external vector store** — pgvector is the vector DB. OpenAI is the only embedding provider; Cohere is used optionally for reranking.

### Assessment

The Postgres layer is the most load-bearing piece and has the most drift. Schema authority: migrations, not `src/db/setup.sql` (see finding #6). DB access is parameterised through the Supabase SDK — no raw SQL concatenation spotted — so SQL-injection risk is minimal. The **abstraction is leaky**: `supabase.from(...)` calls appear outside `src/db/` (at minimum `src/routes/deep-research/paper.ts:503`), and the "repository layer" (`src/db/operations.ts`) is really a flat collection of 30+ free functions rather than an aggregate/entity boundary. `updateConversationState` (`src/db/operations.ts:414-449`) has a non-obvious semantic: it silently preserves `uploadedDatasets` from the DB unless you pass `preserveUploadedDatasets: false`. This papers over a race between chat/deep-research workers and the file-process worker, and is the sort of implicit contract that will break silently during a refactor.

JSONB god blobs — finding #5 — are the dominant persistence smell. `cleanValues()` (`src/db/operations.ts:522-575`) is the purest evidence: the function hand-strips seven named sub-fields (`rawFiles.buffer`, `rawFiles.parsedText`, `uploadedDatasets.buffer`, `plan[].datasets.content`, `plan[].artifacts.content`, etc.) before every write. Each added field is a new hand-written branch here; that list will grow.

Redis usage is sound. Four queues with tuned retention, retry, and attempt counts; rate limiting via atomic `MULTI/EXEC`. One wart: deep-research iterations chain by having each job enqueue the next (per the worker agent's summary) with `rootJobId` + `iterationNumber`, which is a clever way to avoid long-running jobs but makes a single "research run" fragmented across N job records — debugging a run requires aggregating.

S3 abstraction is clean and the only clean transport-agnostic seam in the codebase. Good model for what the rest could look like.

### Recommendations

1. Define Zod schemas for `ConversationStateValues` and `StateValues` and validate on every write (`updateConversationState`, `updateState`). This converts the unstructured JSONB into a checked contract without a schema change.
2. Replace `cleanValues` with per-field strip decisions declared alongside the schema.
3. Move all `supabase.from(...)` calls behind `src/db/`. Add an ESLint rule (`no-restricted-imports` or a custom rule) enforcing that `@supabase/supabase-js` is only imported from `src/db/`.
4. Enable RLS on `conversations`, `messages`, `states`, `conversation_states` with `user_id = auth.jwt()->>'sub'` policies. Service-role bypass still works; this is defense-in-depth.
5. Delete `src/db/setup.sql`. The README should reference `supabase migration up`.
6. Consider a periodic `cleanup_old_states` schedule; the function exists (`setup.sql:116-134` / migration equivalent) but is not scheduled anywhere.

## Readiness for CLI and macOS frontends

**Auth**: already fine. `src/middleware/authResolver.ts` is header-based across four mechanisms (x402 wallet, JWT, API key, anonymous). No cookies. WebSocket auth uses an in-band `{action:"auth", token}` first-message pattern (`src/services/websocket/handler.ts:69-109`), not a query param. A CLI can send `Authorization: Bearer <jwt>` and everything works. The single blocker is **`src/routes/auth.ts` itself**: the "login" endpoint is a single shared password that mints a JWT for a fixed hard-coded UUID (`550e8400-e29b-41d4-a716-446655440000`), so "different users" do not really exist today in the web flow. Any new client that wants to issue its own JWTs needs either a real user model or to take over JWT issuance externally.

**Streaming**: not present. Both CLI and macOS apps need token-by-token output. Responses today are either synchronous batch JSON (`src/routes/chat.ts:721-727`) or queue-mode + poll-status (`src/routes/chat.ts:488-536`). WebSocket broadcasts are *notifications*, not payloads — the client is still expected to fetch the full message over HTTP. SSE on `/api/chat` and on a `/api/deep-research/stream/:messageId` endpoint would unblock both clients with low ceremony.

**Response contracts**: response shapes are defined inline in handlers; the schemas in `src/types/core.ts` describe internal state, not the HTTP surface. There is no OpenAPI or Zod-validated response anywhere. A CLI in Go or Rust has nothing to codegen against; an engineer will hand-write DTOs. Adding `@elysiajs/swagger` and annotating the main routes would produce a usable spec for free.

**Orchestration coupling**: the business logic for chat and deep research lives in HTTP handlers (findings #1, #3), so even a Bun-based CLI cannot import and drive the agent directly without re-implementing the setup. The chat agent runner (`src/chat-agent/runner.ts`) is the counter-example of how this *should* look: a pure function that accepts parameters and returns a result, independent of transport.

**Frontend bundled with backend**: `src/index.ts:154-209, 341-371` always serves `client/dist/index.html` and the bundled JS/CSS, and the catch-all route serves the SPA for any non-`/api`, non-`/admin` path. There is no `SERVE_UI=false` toggle. For a headless server image this means either carrying the SPA bundle or patching out those routes.

**Payment (x402/b402)**: the middleware is cleanly isolated per the agent report, but the only consumer interface is HTTP header-based. A CLI that wants to pay must speak HTTP with `PAYMENT-SIGNATURE` / `X-PAYMENT` headers. That is fine; it does mean there is no library-level "verify this proof" abstraction a third-party integrator could use.

**Verdict**: auth, payment headers, and storage are CLI/macOS-ready today. Streaming, orchestration extraction, response contracts, and the single-password login flow all need work before a second frontend ships. Roughly: **auth is 9/10, storage 9/10, payments 7/10, orchestration 3/10, streaming 0/10.**

## Appendix: notable files and line references

- `src/routes/deep-research/start.ts` — 2113 lines; primary inheritance risk. In-process + queue dual-mode entangled with agent orchestration.
- `src/services/queue/workers/deep-research.worker.ts` — 1494 lines; near-duplicate of the above for queue mode.
- `src/routes/chat.ts:240-745` — `chatHandler`, the one cleanly extractable HTTP handler; model for the rest.
- `src/chat-agent/runner.ts` — the transport-agnostic agent entry point; this is the pattern to replicate.
- `src/routes/auth.ts:38-42` — hardcoded dev UUID; multi-user gap in the web login flow.
- `src/routes/x402/deep-research.ts:31-80` — status-lookup logic duplicated instead of calling `deepResearchStatusHandler`.
- `src/middleware/authResolver.ts` — four-way auth precedence; already well-suited to non-browser clients.
- `src/middleware/rateLimiter.ts:62-68` — silently disabled when `USE_JOB_QUEUE=false`.
- `src/db/operations.ts:414-449` — `updateConversationState`'s implicit `preserveUploadedDatasets=true` contract papering over a worker race.
- `src/db/operations.ts:522-575` — `cleanValues`: hand-rolled JSONB sub-field stripping; canonical evidence of god-blob growth.
- `src/db/client.ts` / `src/db/operations.ts:7` — service-role Supabase client that bypasses RLS.
- `src/db/setup.sql` — drifted schema; drop it.
- `supabase/migrations/20251217123219_remote_schema.sql` — authoritative schema.
- `src/services/websocket/handler.ts:69-109` — WebSocket auth; good pattern, no token-streaming path though.
- `src/services/queue/queues.ts` + `src/services/queue/notify.ts` — BullMQ queues + Redis pub/sub bridge to WebSocket.
- `src/storage/` — the cleanest module in the repo; the rest should aspire to this shape.
- `src/index.ts:154-209, 341-371` — SPA serving routes, no `SERVE_UI=false` toggle.
- `src/index.ts:289-327` — admin dashboard conditionally protected by `ADMIN_PASSWORD`; open by default.
- `docker-compose.swarm.yml` — `:latest` tag; replace with SHA.
- `docker-compose.yml:158-170` — Redis `maxmemory-policy noeviction`; change to `allkeys-lru`.
- `.github/workflows/deploy-worker.yml` — the entire CI. Add tests, type-check, lint.
- `.env.example:6, 12, 24, 28` — defaults for `BIOAGENTS_SECRET`, `AUTH_MODE`, `ALLOWED_ORIGINS`, `MAX_JWT_EXPIRATION`; fail-closed these in production.
