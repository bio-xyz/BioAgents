# Adaptive Deep Research Flow

This is a brainstorming artifact for improving Deep Research beyond the current
fixed phase pipeline. It is not an implementation plan yet.

## Current Flow

The current implementation runs a fixed sequence on every iteration. The tasks
inside execution are dynamic, but the orchestration shape is static.

```mermaid
flowchart TD
  A[User starts deep research] --> B{Queue mode?}
  B -->|USE_JOB_QUEUE=false| C[Run background in API process]
  B -->|USE_JOB_QUEUE=true| D[Enqueue BullMQ iteration job]

  C --> E[Planning phase]
  D --> E

  E --> F[Execute current-level tasks]
  F --> F1[LITERATURE tasks in parallel]
  F --> F2[ANALYSIS tasks in parallel]
  F1 --> G[Hypothesis phase]
  F2 --> G

  G --> H[Reflection and discovery phase]
  H --> I[Next-steps planning phase]
  I --> J[Continue-decision phase]
  J --> K[Reply phase]

  K --> L{Continue?}
  L -->|No| M[Final response saved]
  L -->|Yes, in-process| N[Promote suggested next steps]
  N --> E
  L -->|Yes, queue mode| O[Promote suggested next steps]
  O --> P[Create agent continuation message]
  P --> Q[Enqueue next iteration job]
  Q --> E
```

## Proposed Flow

The proposed architecture keeps the useful primitives, but changes the loop from
a fixed assembly line into an adaptive evidence loop.

```mermaid
flowchart TD
  A[User starts deep research] --> B[Orient request]
  B --> B1[Classify intent, constraints, files, source selection, output goal]
  B1 --> C[Build research agenda]

  C --> C1[Open questions]
  C --> C2[Candidate hypotheses]
  C --> C3[Evidence needed]
  C --> C4[Initial task batch]

  C4 --> D[Evidence acquisition]
  D --> D1[Literature search tasks]
  D --> D2[Analysis tasks]
  D --> D3[Optional targeted follow-up tasks]

  D1 --> E[Evidence ledger]
  D2 --> E
  D3 --> E

  E --> F[Synthesis controller]
  F --> F1[Update claims and confidence]
  F --> F2[Track contradictions]
  F --> F3[Identify remaining evidence gaps]
  F --> F4[Decide stop, continue, or ask user]

  F4 --> G{Decision}
  G -->|Enough evidence| H[Generate final answer or paper draft]
  G -->|Need more evidence| I[Prioritize next task batch]
  G -->|Ambiguous / user choice needed| J[Ask user focused question]

  I --> D
  J --> K[User steering]
  K --> C
```

## Evidence Ledger

The core state should move from mostly free-text task outputs to a structured
ledger that every loop reads and updates.

```mermaid
flowchart LR
  A[Task output] --> B[Extract evidence items]
  B --> C[Claim]
  B --> D[Source or artifact]
  B --> E[Confidence]
  B --> F[Contradictions]
  B --> G[Open verification needs]

  C --> H[Evidence ledger]
  D --> H
  E --> H
  F --> H
  G --> H

  H --> I[Synthesis controller]
  I --> J[Next task priority]
  I --> K[Stop condition]
  I --> L[Final answer]
```

Suggested shape:

```ts
type EvidenceLedger = {
  claims: Array<{
    claim: string;
    evidence: Array<{
      taskId: string;
      sourceUrl?: string;
      doi?: string;
      artifactId?: string;
      finding: string;
    }>;
    confidence: "low" | "medium" | "high";
    contradictions: string[];
    needsVerification: string[];
  }>;
  openQuestions: string[];
  nextTasks: PlanTask[];
};
```

## Why This Is Better

### Fewer sequential LLM calls

The current loop splits hypothesis, reflection, next-step planning, continue
decision, and reply into separate phases. Those phases all inspect the same
task outputs and world state. Combining most of that into a single synthesis
controller removes repeated context loading and reduces latency.

### Less unnecessary user-facing writing

The current loop generates a reply every iteration, even when it will continue
automatically. A better loop emits progress and updates structured state during
intermediate iterations, then writes a user-facing response only when stopping,
asking for steering, or explicitly producing a checkpoint.

### Better research quality

The current system can accumulate useful text, but it does not make evidence the
main control surface. An evidence ledger lets the controller decide based on
claim support, contradictions, missing citations, and confidence rather than
only whether `suggestedNextSteps` exists.

### More adaptive task selection

The current phase order is static. It always does planning, execution,
hypothesis, reflection, next-step planning, continue decision, and reply. The
adaptive loop still has stable invariants, but can skip work that is not useful:

- no analysis task if there is no usable dataset or artifact;
- no new literature search if the evidence gap is analytical;
- no final prose generation until the loop stops;
- no continuation when new tasks have low marginal value.

### Cleaner stopping criteria

The current loop stops mostly through empty next-step plans, mode rules, or
iteration caps. The proposed loop can stop because specific evidence conditions
are met:

- enough high-confidence claims answer the question;
- remaining gaps are low value;
- sources contradict each other and user steering is needed;
- external task failures prevent useful progress;
- budget or time limits are reached.

## Migration Path

This can be introduced incrementally without deleting the current phase modules.

```mermaid
flowchart TD
  A[Keep existing planning and execution phases] --> B[Add EvidenceLedger type]
  B --> C[Extract evidence from literature and analysis outputs]
  C --> D[Add synthesis controller]
  D --> E[Controller replaces hypothesis plus reflection plus next-steps plus continue-decision]
  E --> F[Reply only on final or steering checkpoints]
  F --> G[Measure latency and answer quality]
```

Recommended first implementation step:

1. Keep `runPlanningPhase` and `runExecutionPhase`.
2. Add a `runSynthesisDecisionPhase` that returns:
   - updated hypothesis;
   - key insights;
   - discoveries;
   - evidence ledger updates;
   - next tasks;
   - stop / continue / ask-user decision.
3. Keep the existing reply phase, but call it only when the controller says the
   iteration should produce a user-facing checkpoint.

