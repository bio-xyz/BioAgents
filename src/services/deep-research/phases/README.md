# Deep-research phases

Each file in this directory is one phase of a single deep-research iteration.
The shared phases are consumed by both transports:

- in-process (`src/routes/deep-research/start.ts:runDeepResearch`) — loops the
  phases in memory across iterations.
- queue worker (`src/services/queue/workers/deep-research.worker.ts`) — runs
  the phases once, then enqueues a new job for the next iteration.

## Phase order within a single iteration

```
planning           Resolves the iteration's plan + currentObjective.
                   Three paths: continuation (skip), clarification
                   (pre-approved tasks), default (planningAgent).

execution          Fans out LITERATURE + ANALYSIS tasks for the current
                   level. Mutates each task in place; state writes are
                   serialised through the caller-supplied write chain.

hypothesis         Generates/updates conversationState.values.currentHypothesis
                   from completed-task outputs.

reflection-discovery
                   Reflection always runs (updates conversationTitle,
                   currentObjective, keyInsights, methodology). Discovery
                   runs conditionally on getDiscoveryRunConfig.

next-steps         planningAgent(mode='next') produces suggestedNextSteps.
                   Empty plan => research complete.

continue-decision  Decides autonomy vs hand back to user. Must run before
                   reply because reply reads isFinal/willContinue.

reply              replyAgent writes the user-facing reply, markMessageComplete
                   persists it onto the message row, finalResponse written on
                   isFinal iterations.

continuation-prep  Only if continue-decision said `willContinue`. Promotes
                   suggestedNextSteps into the plan with new ids/level,
                   creates the agent-only message the next iteration writes
                   into. Caller decides scheduling (route loops; worker
                   enqueues).
```

## Design notes

- **Phases are mode-agnostic.** Each takes the conversation state by reference,
  mutates it in place, and persists via a caller-supplied callback. The
  caller's callbacks are where per-mode behaviour lives (worker also notifies
  the queue, etc.).
- **Agents are dependency-injected** with sensible dynamic-import defaults.
  Tests pass deterministic stubs from `src/utils/__testHelpers__/deepResearch.ts`.
- **No static imports of LLM-heavy modules.** `db/operations`, `llm/provider`,
  and `utils/deep-research/objective-trace` are reached only via dynamic
  imports or DI. This keeps the phase modules unit-testable without env
  configuration.
- **Cancellation is per-phase-boundary** via `assertNotCancelled()`. Each phase
  calls it at its entry; `planning` and `execution` re-check between sub-steps.
- **State writes inside execution are serialised** via the
  `writeStateSerialized` callback. Both transports already maintained this
  pattern internally; the phase just expects a `() => Promise<unknown>`
  callback.

## Test surfaces

- Each phase has a focused unit test under `../__tests__/<phase>.test.ts`.
- `../__tests__/phases.integration.test.ts` exercises the full chain against a
  live local Supabase (via `RUN_SUPABASE_INTEGRATION=1 supabase start`).
- All agent stubs live in `src/utils/__testHelpers__/deepResearch.ts`.
