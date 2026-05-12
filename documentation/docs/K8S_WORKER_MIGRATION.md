# Kubernetes Worker Migration

Migration of BullMQ worker processes from Docker Swarm to AWS EKS (production) and kind (local dev). Workers only; API + Redis remain external until a separate migration pass.

## Context & non-goals

### Why migrate

Two requirements drive the move:

1. **Per-queue horizontal scaling tied to actual queue depth.** Today a single Swarm service runs every BullMQ worker in one process, so scaling is in lockstep across queues and based on coarse resource pressure rather than backlog. We want to scale each queue independently against its own depth signal.
2. **Job-preserving releases.** Every in-flight job must complete on the worker that picked it up; new jobs enqueued after a release must be picked up only by workers running the new code. `worker.close()` already gives us "stop pulling new jobs, drain in-flight, exit"; the design hinges on per-queue grace periods large enough to cover each queue's max job duration so SIGTERM never kills a running job.

A single Deployment forces all queues to inherit the worst-case grace period — an 8h drain on chat redeploys because deep-research lives in the same pod. Splitting the queues across multiple Deployments lets each pick a grace tuned to its own max job duration.

### Out of scope

- API server migration to EKS
- Redis migration (stays on managed Upstash)
- Bull Board exposure under the new cluster (still API-side)
- WebSocket fanout topology (still API-side)
- EKS infra provisioning (separate Terraform workstream)

## Decisions

| Area | Choice | Rationale |
|---|---|---|
| Workload kind | `Deployment` | workers are long-lived pullers; state lives in Redis. `Job` and `StatefulSet` semantics don't match |
| Topology | 4 Deployments, 1 image | per-queue grace + node strategy + resource profile, single CI artifact |
| `worker-heavy` | paper-generation + file-process merged | similar resource profile, KEDA supports multi-trigger scaling |
| `message-sweeper` | stays in BullMQ scheduler, dedicated tiny Deployment | scheduler-survives-scale-to-zero without code change |
| Cluster strategy | single EKS cluster, two namespaces | cheaper, simpler than two clusters; sufficient isolation for workers |
| Branch → env | `dev` → staging, `main` → prod | standard GitHub-flow promotion |
| Image tagging | `:sha-<short>` immutable + branch tag | immutable for GitOps; branch tag for convenience |
| Registry | GHCR (`ghcr.io/bio-xyz/bioagents`) | already on GitHub; auth via PAT-backed `imagePullSecret` |
| IaC (EKS) | Terraform — `infra/terraform/` | community-mature; covers VPC + EKS + IAM + S3 + Helm releases for Loki/Alloy |
| Deploy | `kubectl apply -k` from GitHub Actions | simplest path; ArgoCD when second app joins the cluster |
| Secrets | plain k8s `Secret` from CI store | ESO + AWS Secrets Manager deferred to v1.1 |
| Autoscaling | KEDA + Redis list scaler | only signal that reflects actual backlog |
| Nodes | MNG + Cluster Autoscaler | predictable; Karpenter when scope grows |
| Spot | deferred (on-demand only at launch) | de-risk cutover; cost optimisation later |
| Logging | stdout → Grafana Alloy DaemonSet → in-cluster Loki (S3 chunks) | Better query UX than CloudWatch; pairs with the metrics stack we'll add later |
| Metrics | deferred | Bull Board on API side covers v1 visibility |
| Pod security | Restricted PSS | Dockerfile already runs as `bun`; no image change |
| NetworkPolicy | deferred to v1.1 | de-risk cutover; add `default-deny` + allowlist after stable |
| Release strictness | standard rolling update | brief poll-overlap window during surge is acceptable |

## Environments

Two independent environments deployed from separate branches:

| Env | Branch | Namespace | Redis | Supabase | Image tag |
|---|---|---|---|---|---|
| Staging | `dev` | `bioagents-staging` | dedicated Upstash instance | dedicated Supabase project | `:dev-sha-<short>` + `:dev` |
| Production | `main` | `bioagents-prod` | dedicated Upstash instance | dedicated Supabase project | `:sha-<short>` + `:main` |

Single EKS cluster, two namespaces. Isolation comes from separate Redis instances (BullMQ queues never cross envs) and separate Supabase projects (data never crosses). ResourceQuotas on each namespace prevent one env from starving the other. ServiceAccounts are namespace-scoped.

Trade-off accepted: shared control plane upgrades, shared node-pool noisy-neighbour risk. Revisit if compliance or scale demands two clusters.

**Pre-cutover assumption to verify**: staging and prod already use separate Redis instances and separate Supabase projects.

## Topology

`terminationGracePeriodSeconds` is a **ceiling**, not a fixed delay. SIGTERM triggers `worker.close()`; the pod exits the instant in-flight jobs finish. The timer only fires as a fail-safe to SIGKILL stuck pods. Sizing rule: pick a defensive upper bound on legitimate job duration per queue. Oversizing is free in the happy path; undersizing kills in-flight work on rollouts.

| Deployment | Queues | Grace | Rationale | Nodes | QoS | KEDA trigger |
|---|---|---|---|---|---|---|
| `worker-deep-research` | `deep-research` | 28800 (8h) | matches current Swarm `stop_grace_period`; already vetted | on-demand; `safe-to-evict: false`; PDB `maxUnavailable: 0`; `progressDeadlineSeconds: 28800` | Burstable (no memory limit) | `bull:deep-research:wait` |
| `worker-chat` | `chat` | 600 (10min) | upper bound of `CHAT_TOOL_TIMEOUT_MS × CHAT_AGENT_MAX_TOOL_CALLS` + LLM latency | on-demand (spot later) | Burstable | `bull:chat:wait` |
| `worker-heavy` | `paper-generation`, `file-process` | 3600 (1h) | generous ceiling over Pandoc/LaTeX and OCR/PDF parse | on-demand; `/tmp` `emptyDir` 5Gi for LaTeX intermediates | Burstable | max of `bull:paper-generation:wait`, `bull:file-process:wait` |
| `worker-scheduled` | `message-sweeper` | 120 | sweeper jobs are trivial | anywhere; static `replicas: 1`; never scaled to zero so the schedule survives | Burstable | none |

Same topology across staging and prod. Per-env differences (KEDA `min`/`max`, resource requests, `REDIS_URL`, Supabase URL/keys) live in Kustomize overlays.

## Code changes

Single change in `src/worker.ts`:

### Env-gated worker startup

Each `start*Worker()` call is wrapped by an `ENABLE_*_WORKER` env flag (default `true`, preserving docker-compose behaviour). One image, multiple Deployments, each setting a different combination:

- `ENABLE_DEEP_RESEARCH_WORKER`
- `ENABLE_CHAT_WORKER`
- `ENABLE_PAPER_GENERATION_WORKER`
- `ENABLE_FILE_PROCESS_WORKER`
- `ENABLE_MESSAGE_SWEEPER_WORKER` (also gates `registerMessageSweeperSchedule()`)

The shutdown promise list is built from the enabled subset only. Worker startup aborts if no workers are enabled (misconfiguration safeguard).

### Health endpoint

`Bun.serve()` listener on `WORKER_HEALTH_PORT` (default `9000`). Native Bun, not Elysia — keeps the worker process dependency-free.

- `GET /health/ready` — `200` if every enabled BullMQ `worker.isRunning()` is true AND the BullMQ Redis client status is `"ready"`. Used by readiness probe; gates the rolling-update transition.
- `GET /health/live` — `200` if every enabled `worker.isRunning()` is true AND Redis status is `"ready" | "connecting" | "reconnecting"`. Lenient on transient blips so a Redis hiccup doesn't trigger a pod restart mid-job.

The HTTP listener is stopped inside the SIGTERM handler before `worker.close()` is called, so K8s sees the pod as "terminating" cleanly during the drain.

## Operational model

### Release sequence

Rolling update per Deployment: `maxSurge: 100%`, `maxUnavailable: 0`, `progressDeadlineSeconds ≥ grace`.

1. New replicas spawn alongside old.
2. New replicas pass `/health/ready` → begin polling Redis.
3. K8s sends SIGTERM to old replicas. `worker.close()` stops them pulling new jobs; in-flight jobs continue.
4. Old replicas finish in-flight, exit. New replicas handle all subsequent new jobs.

In-flight jobs always complete on the worker that picked them up. Jobs enqueued after release land on new-version workers.

Known property: a few-second window exists between step 2 (new replicas Ready, polling) and step 3 (SIGTERM delivered to old), where both versions poll the queue. A job enqueued in that window may land on either. Acceptable for the stated requirement; tightening would require pausing the queue at release time (downtime) or pre-SIGTERM-ing old replicas (start-last, also downtime).

### Autoscaling

KEDA `ScaledObject` per Deployment, Redis list scaler on the BullMQ wait list:

| Queue | min | max | Notes |
|---|---|---|---|
| `deep-research` | 1 | 5 | bounded by LLM rate limits |
| `chat` | 1 | 10 | bursty; could scale to 0 later if cold start acceptable |
| `heavy` | 1 | 3 | two triggers (paper-gen + file-process), scales to max |
| `scheduled` | 1 | 1 | static; KEDA not used |

Starting numbers are conservative; tune after a week of production telemetry.

`cooldownPeriod` defaults are fine — scale-down still triggers SIGTERM + grace, so jobs drain cleanly.

### Shutdown semantics

Already captured by `worker.close()` in `src/worker.ts`. No behavioural change from Swarm; only the orchestration layer changes.

Cluster Autoscaler scale-down: `worker-deep-research` Deployment annotated `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"` so 8h-in-flight jobs don't get evicted during node compaction. Other Deployments are evictable.

`PodDisruptionBudget`:
- `worker-deep-research`: `maxUnavailable: 0` — voluntary disruption (node drain, cluster upgrade) is gated until safer
- Others: `minAvailable: 1`

### Resource limits — no memory ceiling

All worker containers ship with CPU limits but **no memory limit**. Reason: an OOMKill is a hard, signal-less termination — `worker.close()` does not run, the in-flight BullMQ job dies without a graceful exit, and the drain guarantee is broken. CPU limits throttle rather than kill, so they're safe to keep.

Consequences:
- Every worker Deployment is Burstable QoS (not Guaranteed). Under node memory pressure, eviction can target worker pods — but eviction is graceful (SIGTERM + grace), unlike OOMKill.
- Node-pressure eviction is now the failure mode for runaway memory, not OOMKill. Cluster Autoscaler/Karpenter should size nodes with comfortable memory headroom relative to total worker requests.
- `safe-to-evict: false` on `worker-deep-research` still protects against autoscaler scale-down compaction.

### Liveness probe & event-loop assumption

The `/health/live` endpoint is served by `Bun.serve` on the same event loop as the BullMQ worker. The liveness probe is tuned generously to tolerate legitimate event-loop pressure (large LLM responses, OCR/PDF parses, GC pauses):

```yaml
livenessProbe:
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 10   # 10 × 30s = 300s budget before restart
```

This assumes job code stays **mostly I/O-bound** — `await`-yielding to the event loop so the HTTP handler can respond between operations. CPU-bound work that monopolises the loop for more than ~5 minutes will trigger a restart and kill the in-flight job. Pandoc/LaTeX in `worker-heavy` runs as a subprocess via `Bun.spawn`, so it doesn't block the parent loop; if we add new CPU-bound work, it must do the same.

BullMQ's own stall detection (lock extension via `stalledInterval`) is the primary recovery path for deadlocked workers; the k8s liveness probe is the long-tail fallback for cases BullMQ can't catch.

### Node strategy

Single managed node group (`workers-ondemand`, m6i.large baseline) tainted `workload=worker:NoSchedule`. All four worker Deployments tolerate. Cluster Autoscaler manages scale.

Topology spread across ≥2 AZs for `worker-deep-research` (avoid losing all replicas if a zone goes).

Spot node group + `worker-chat` toleration deferred to v1.1.

### Observability

- **Logs**: stdout (pino) → Grafana Alloy DaemonSet → in-cluster Loki (simple-scalable mode, S3-backed chunks via IRSA). Per-namespace labels. Query via LogQL in Grafana. CloudWatch was the obvious EKS default but its query UX gets painful at any volume; Loki is the standard answer when we expect to grep logs regularly.
- **Metrics**: deferred. Bull Board on the API side (still on Coolify) shows queue depth and job state. CloudWatch container metrics give pod CPU/memory. Prometheus/Grafana stack arrives with the API migration.
- **Traces**: not in scope.

## Repository layout

```
k8s/
├── base/
│   ├── configmap.yaml             # shared non-secret env shape
│   ├── worker-deep-research/
│   │   ├── deployment.yaml
│   │   ├── pdb.yaml
│   │   └── scaledobject.yaml
│   ├── worker-chat/{...}
│   ├── worker-heavy/{...}
│   └── worker-scheduled/{deployment.yaml,pdb.yaml}
└── overlays/
    ├── kind/                       # local dev
    ├── eks-staging/                # bioagents-staging ns
    └── eks-prod/                   # bioagents-prod ns
```

Each EKS overlay supplies:
- `namespace.yaml` with Restricted PSS labels
- `secret.yaml` rendered from the CI secret store
- `pull-secret.yaml` for GHCR PAT
- ConfigMap patches (env-specific concurrency, model overrides)
- ScaledObject patches (env-specific replica caps)
- `kustomization.yaml` pinning the image tag

## CI/CD

Two GitHub Actions workflows:

### `build-image.yml`

- Triggers: push to `dev`, push to `main`, tagged release.
- Builds the Docker image, pushes to GHCR with `:sha-<short>` always, plus `:dev` or `:main` per branch, plus `:v*` on tags.

### `deploy-workers.yml`

- Triggers: completion of `build-image.yml` on `dev` or `main`; manual `workflow_dispatch`.
- Branch `dev` → `kubectl apply -k k8s/overlays/eks-staging`.
- Branch `main` → `kubectl apply -k k8s/overlays/eks-prod`.
- AWS auth via GitHub OIDC; one IAM role per env (`bioagents-deployer-staging`, `bioagents-deployer-prod`). The prod role's trust policy restricts assumption to `ref:refs/heads/main` via the OIDC `sub` claim.
- Concurrency keyed by `${{ github.ref }}` to prevent overlapping deploys per env.

Promotion: open PR `dev → main`; merge triggers prod deploy referencing the same `:sha-<short>` tag that was already validated in staging. No rebuild on promotion.

## Phasing

1. Code: `src/worker.ts` env gates + `Bun.serve` health endpoint. `bun typecheck && bun test`.
2. Docs: this document + `.claude/tasks/k8s-worker-migration.md` tracker.
3. CI: GHCR build pipeline for both branches.
4. Local: kind cluster, `overlays/kind` against external Upstash dev. Verify each Deployment processes only its enabled queue(s).
5. KEDA install on kind; synthetic queue depth → scaling verified.
6. EKS infra (Terraform — separate workstream): cluster, namespaces, MNG, IRSA, OIDC trust.
7. Cluster addons (logging): Loki + Alloy via Helm; S3 bucket for chunks via IRSA. Verify pod stdout reaches Loki.
8. EKS staging: apply `overlays/eks-staging`. Soak ≥1 week; tune KEDA min/max.
9. EKS prod: apply `overlays/eks-prod`. Run parallel to Swarm; throughput additive on shared Redis.
10. Cutover prod: drop Swarm replicas to 0 once EKS prod steady (48h shadow).
10. Decommission Swarm worker stack.

## Risks

- **GHCR PAT rotation** — PAT in `imagePullSecret` is a small ops liability. Mitigate via short-lived token and a rotation runbook; ESO + AWS Secrets Manager is the long-term path.
- **8h rollout latency for deep-research** — any `worker-deep-research` deploy takes up to 8h to fully drain. Acceptable; `progressDeadlineSeconds: 28800` keeps the Deployment from reporting failure.
- **KEDA defaults are guesses** — initial replica caps are conservative; expect a tuning pass after a week of prod telemetry.
- **Release overlap window** — few-second window during rolling update where both old and new replicas poll the queue. Documented; tightening requires accepting downtime.
- **Shared cluster, two namespaces** — staging noisy-neighbour can affect prod node scheduling. Acceptable at current scale; revisit if either env grows to dominate the cluster.
- **OIDC trust scope for prod** — prod deploy role must only be assumable from `main`. Misconfiguration could let a `dev` workflow push to prod. Mitigate via `sub` claim condition in the IAM trust policy; verify during step 6.

## Deferred work

- **Spot for chat** — cost optimisation; add a spot node group + `worker-chat` toleration once the on-demand stack is stable.
- **NetworkPolicy hardening** — start permissive; add `default-deny` + explicit egress allowlist (Redis, Supabase, LLM APIs, S3) once stable.
- **`message-sweeper` → K8s `CronJob`** — more idiomatic; drops the `worker-scheduled` Deployment. Not worth the code change at cutover.
- **ESO + AWS Secrets Manager** — replaces plain k8s `Secret` and the GHCR PAT runbook. Right move once secret rotation pressure justifies the operator install.
- **BullMQ Prometheus exporter** — when metrics demand exceeds what Bull Board provides.
- **API + Redis migration** — separate design pass when API leaves Coolify.
