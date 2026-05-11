# BIOS Backend Architecture Review

## Executive summary

BIOS is still a Bun + Elysia monolith for chat and iterative deep research, backed by Supabase/Postgres (with pgvector), Redis/BullMQ, and S3. Since this review was first drafted, the branch has been rebased onto `dev` and PR #156 changes are now present: x402/b402 code was removed, TypeScript strictness was tightened, Biome + Husky were added, and CI now runs typecheck/tests.

Shape today: **stronger baseline, same core orchestration risk**. The repository now has real quality infrastructure, but deep-research orchestration is still split across very large route/worker files, queue vs in-process behavior still diverges in important places, streaming is still absent at the API layer, and the core state model remains JSONB-centric.

## Top findings (prioritized)

1. **Deep-research orchestration is still duplicated across two very large files.** `src/routes/deep-research/start.ts` is 1919 lines and `src/services/queue/workers/deep-research.worker.ts` is 1387 lines. Both implement the same lifecycle (planning -> task execution -> hypothesis -> reflection/discovery -> continue/stop) with near-parallel logic branches. **Impact**: iteration behavior changes require dual edits; high regression risk during refactors. **Recommendation**: extract shared orchestration into `src/services/deep-research/orchestrator.ts` and keep route/worker as thin transport shells.

2. **"No CI/tests" is resolved, but quality gates are still shallow around highest-risk paths.** CI now exists in `.github/workflows/ci.yml` (Biome on changed files for PRs, plus `bun run typecheck` and `bun test`), and there are 14 test files under `src/**/__tests__`. However, coverage is concentrated in utilities/adapters; there are still no route-level tests for `chat`, `deep-research/start`, `deep-research/status`, or queue/in-process parity. **Impact**: the most complex orchestration paths remain largely unguarded. **Recommendation**: add focused integration tests for deep-research start/status/retry and queue-vs-in-process parity checks.

3. **Queue mode and in-process mode still diverge semantically.** Chat in-process goes straight through `runChatAgent` (`src/routes/chat.ts`), while queue chat defaults to a legacy planning/literature/hypothesis/reply pipeline unless `CHAT_AGENT_QUEUE_ENABLED=true` (`src/services/queue/workers/chat.worker.ts`). Deep research also keeps separate in-process and worker implementations. **Impact**: behavior can differ between local/dev and production depending on `USE_JOB_QUEUE` and feature flags. **Recommendation**: converge on one execution core per capability and use adapters for sync/async transport only.

4. **No token-streaming API path yet (SSE/WebSocket payload streaming).** There is no `text/event-stream` route in `src/routes/`; status remains poll-based (`/api/chat/status/:jobId`, `/api/deep-research/status/:messageId`), and WebSocket uses notify-then-fetch metadata (`src/services/websocket/handler.ts`, `src/services/queue/notify.ts`). LLM adapters support streaming callbacks, but route/agent loop plumbing does not expose streamed tokens to clients. **Impact**: CLI/native clients cannot render progressive output. **Recommendation**: add SSE for `/api/chat` and deep-research updates; thread model deltas through chat/deep-research runners.

5. **JSONB state blobs remain the primary domain model.** `states.values` and `conversation_states.values` are still unstructured JSONB in persistence terms. `ConversationStateValues` exists as a TypeScript interface (`src/types/core.ts`), but write-time runtime validation is not enforced in `updateConversationState`/`updateState` (`src/db/operations.ts`). `cleanValues` was improved and extracted (`src/db/cleanValues.ts`) with tests, but this is payload trimming, not schema enforcement. **Impact**: malformed state can still persist and couple many agents/routes implicitly. **Recommendation**: add Zod runtime validation at DB write boundaries and introduce versioned state migrations for breaking shape changes.

6. **`src/db/setup.sql` is still drifted and unsafe as a setup source.** It drops/recreates only 5 tables (`users`, `conversations`, `messages`, `states`, `conversation_states`) while current schema evolves through `supabase/migrations/*.sql` (including `paper`, `token_usage`, `clarification_sessions`, `documents`, branching lineage, and other tables). **Impact**: new engineers using `setup.sql` get an incomplete/outdated DB shape. **Recommendation**: retire `src/db/setup.sql` from onboarding and point setup exclusively to Supabase migrations.

7. **Service-role DB access is centralized but still leaks outside `src/db`.** Core DB operations use `getServiceClient()` (bypassing RLS intentionally), and there are still direct `supabase.from(...)` calls outside `src/db` in `src/routes/deep-research/branch.ts`, `src/routes/deep-research/paper.ts`, and `src/services/paper/generatePaper.ts`. Ownership checks are present in these flows, but enforcement is by convention, not architecture. **Impact**: security relies on every caller consistently implementing authorization checks. **Recommendation**: move all table operations behind `src/db/*` and keep route/service layers authorization-only.

8. **`/api/auth/login` remains single-user by design.** `src/routes/auth.ts` still mints JWTs for a fixed UUID (`550e8400-e29b-41d4-a716-446655440000`) when UI password auth is used. **Impact**: browser login path is effectively single-tenant and not a true account model. **Recommendation**: decide and implement a real identity flow (external IdP JWT issuance, or first-class user auth model) before scaling to multi-user frontend usage.

9. **Admin queue dashboard protection improved in production, but can still be open in non-production queue deployments.** `createQueueDashboard()` now disables dashboard mounting in production when `ADMIN_PASSWORD` is missing (`src/routes/admin/queue-dashboard.ts`). In non-production, if queue mode is on and password is unset, `/admin/queues` is mounted without basic auth (`src/index.ts`). **Impact**: staging/dev environments can unintentionally expose job payloads if reachable. **Recommendation**: require explicit opt-in for unauthenticated dashboard access, or require admin auth in all environments by default.

10. **Rate limiter still no-ops when `USE_JOB_QUEUE=false`.** `checkRateLimit` and `rateLimitMiddleware` return early if queue mode is disabled (`src/middleware/rateLimiter.ts`). **Impact**: local and some deployment modes can run without throttling, masking abuse/perf behavior. **Recommendation**: add in-memory fallback limits when Redis/BullMQ is off, with startup warnings when running unthrottled.

## Action matrix

| Finding | Priority | Effort | Risk reduction | Suggested owner | Dependency |
| --- | --- | --- | --- | --- | --- |
| #1 Deep-research orchestration duplication | P0 | L | High | Backend platform | Align on target orchestrator API |
| #2 High-risk flow test depth gaps | P0 | M | High | QA + backend | #1/#3 test seams defined |
| #3 Queue vs in-process behavior drift | P0 | L | High | Backend platform | #1 shared execution core |
| #4 Missing streaming transport | P1 | L | High | API + frontend | #1/#3 core convergence helps |
| #5 No runtime schema validation for state JSONB | P1 | M | High | Data/backend | Agree state schema/versioning approach |
| #6 `setup.sql` schema drift | P1 | S | Medium | Developer experience | Docs/setup update approval |
| #7 Direct Supabase table access outside `src/db` | P1 | M | Medium | Backend platform | Define `src/db` ownership boundaries |
| #8 Single-user `/api/auth/login` shim | P2 | M | Medium | Product + auth/backend | Decide identity strategy (IdP vs native) |
| #9 Admin dashboard can be open in non-prod | P2 | S | Medium | Infra/backend | Policy decision for non-prod access |
| #10 Rate limit disabled when queue disabled | P2 | S | Medium | API/backend | Select in-memory limiter behavior |

### Suggested execution order

1. **Stabilize execution core**: #1 and #3 together.
2. **Lock confidence**: #2 immediately after initial extraction milestones.
3. **Unblock multi-frontend UX**: #4 in parallel once core interfaces are stable.
4. **Harden data/contracts**: #5 and #7.
5. **Clean operational hygiene**: #6, #9, #10.
6. **Finalize product auth direction**: #8.

## Repository structure

### What's there

Top-level structure remains coherent for a Bun monolith: `src/`, `client/`, `supabase/migrations/`, docs, compose files, and a single Dockerfile. `src/` keeps clear folders (`routes`, `services`, `agents`, `middleware`, `db`, `llm`, `chat-agent`, etc.). x402/b402 route/middleware trees are gone.

### Assessment

Layering exists but orchestration still lives primarily in route/worker files:

- `src/routes/deep-research/start.ts` (1919 lines)
- `src/services/queue/workers/deep-research.worker.ts` (1387 lines)
- `src/routes/deep-research/paper.ts` (676 lines)
- `src/routes/chat.ts` (620 lines)
- `src/services/queue/workers/chat.worker.ts` (588 lines)
- `src/routes/clarification.ts` (457 lines)

`src/services/deep-research/` currently contains `run-guard.ts` only; there is still no extracted orchestration core. Chat has some reuse (`runChatAgent`) but also keeps mode-specific behavior drift (finding #3).

### Recommendations

1. Extract deep-research orchestration to shared service modules and remove route/worker duplication.
2. Unify chat queue/in-process behavior (single execution core, transport wrappers only).
3. Move direct Supabase table calls from route/service files into `src/db` operations.
4. Keep route files as transport/adaptation layers; target <200 lines for most handlers.
5. Remove `src/db/setup.sql` from setup docs and scripts.

## Deployment & runtime requirements

### What's there

`Dockerfile` builds app + client and installs TeX/Pandoc dependencies needed for paper generation. CI now has:

- `.github/workflows/ci.yml` (lint/format on PR changed files, typecheck, tests, PR docker smoke build)
- `.github/workflows/deploy-worker.yml` (build/push and deployment webhook on `dev`/`main` pushes)

Compose/swarm deployment files are present for API + worker topologies.

### Assessment

Quality posture is better than before, but runtime/ops risks remain:

- `docker-compose.swarm.yml` still defaults to `biosagent/bios:latest`.
- `docker-compose.yml` still configures Redis with `--maxmemory-policy noeviction`.
- Worker healthcheck remains `pgrep -f worker` (process liveness, not queue processing health).
- Security settings still favor warnings over fail-closed behavior in several startup paths.

### Recommendations

1. Pin deploy images to immutable SHA tags in swarm configs.
2. Revisit Redis eviction policy for queue robustness under memory pressure.
3. Replace process-only worker healthchecks with queue-aware health probes.
4. Add targeted integration tests for deep-research and queue workflows to CI.

## Persistence layers

### What's there

- **Postgres (Supabase)** via migration files under `supabase/migrations/`.
- **Redis (BullMQ + pub/sub + rate limiter)** for queueing and notifications.
- **S3-compatible storage** through `src/storage/` provider abstraction.

x402 tables are now removed by migration (`20260414000000_drop_x402_tables.sql`).

### Assessment

Persistence architecture is functional but still schema-contract fragile at the state boundary:

- `ConversationStateValues`/`StateValues` are TypeScript-only contracts; DB writes do not enforce runtime schema.
- `cleanValues` now has dedicated tests and cleaner isolation, but it is still a manual strip list.
- RLS is enabled only on newer tables (`token_usage`, `clarification_sessions`) with permissive policies; core conversation/message/state tables still rely on service-role access + middleware checks.
- `src/db/setup.sql` remains drifted from migration-driven reality.

### Recommendations

1. Add runtime schema validation before persisting state JSONB.
2. Version state payloads and add migration helpers for shape changes.
3. Consolidate table access behind `src/db` boundary.
4. Keep Supabase migrations as the only schema source of truth.

## Readiness for CLI and macOS frontends

**Auth**: header-based auth is now JWT/API key/anonymous (no x402/b402). This fits CLI/native clients. Remaining gap is single-user UI login shim (`/api/auth/login`).

**Streaming UX**: still missing at transport layer. Clients rely on poll status + notify/fetch patterns.

**Contracts**: no generated OpenAPI/Swagger spec; response contracts are mostly implicit per-handler.

**Orchestration reuse**: deep-research logic is transport-coupled (route/worker), making SDK-level reuse harder for additional frontends.

**Bundling**: backend still serves SPA by default via catch-all in `src/index.ts`; no explicit headless server toggle.

**Verdict**: onboarding/quality baseline is improved, but frontend expansion still depends on (1) orchestration extraction, (2) streaming responses, and (3) stronger state-contract enforcement.

## Appendix: notable files and line references

- `src/routes/deep-research/start.ts` - 1919 lines; in-process deep-research orchestration + queue enqueueing.
- `src/services/queue/workers/deep-research.worker.ts` - 1387 lines; queue-mode deep-research orchestration.
- `src/routes/chat.ts` - dual-mode chat handler.
- `src/services/queue/workers/chat.worker.ts` - queue chat path with feature-flagged legacy vs agent-loop execution.
- `src/chat-agent/runner.ts` and `src/chat-agent/loop.ts` - reusable chat agent core (currently non-streaming route integration).
- `.github/workflows/ci.yml` - current CI quality gates.
- `.github/workflows/deploy-worker.yml` - deployment workflow.
- `src/middleware/rateLimiter.ts` - queue-disabled early-return behavior.
- `src/routes/auth.ts` - fixed UUID login flow.
- `src/routes/admin/queue-dashboard.ts` and `src/index.ts` - admin dashboard exposure rules.
- `src/db/operations.ts` and `src/db/cleanValues.ts` - JSONB write path and cleanup behavior.
- `src/db/setup.sql` vs `supabase/migrations/*.sql` - schema drift source.
