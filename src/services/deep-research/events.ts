/**
 * Event sink interface for the deep-research orchestrator.
 *
 * The orchestrator runs ONE iteration through all phases. Each phase reports
 * lifecycle events through these hooks; the transport adapter (route or
 * worker) supplies whichever subset it cares about. Hook failures are
 * absorbed by the orchestrator and never bubble up — a missed notification
 * must never break a research run.
 *
 * BIOS-82 (deep-research SSE) will consume the same interface to stream
 * events to the client, so phase / progress names are deliberately stable
 * and align with the existing BullMQ `JobProgress` stages.
 */

import type { DeepResearchActivityPhase, PlanTask } from "../../types/core";

export type OrchestratorPhase =
  | DeepResearchActivityPhase
  | "hypothesis"
  | "discovery"
  | "next_steps";

export interface PhaseStartEvent {
  phase: OrchestratorPhase;
  iterationNumber: number;
}

export interface PhaseEndEvent {
  phase: OrchestratorPhase;
  iterationNumber: number;
  /** Wall-clock ms spent in the phase. */
  durationMs: number;
}

export interface ProgressEvent {
  /** Percent 0..100 — best-effort, intended for the BullMQ JobProgress shape. */
  percent: number;
  /** Stage label — same string the legacy BullMQ progress used. */
  stage: string;
}

export interface TaskUpdateEvent {
  taskId: string;
  jobId?: string;
  reasoning?: string[];
}

export interface IterationCompleteEvent {
  iterationNumber: number;
  shouldContinue: boolean;
  isFinal: boolean;
  suggestedNextSteps: PlanTask[];
}

export interface OrchestratorEvents {
  onPhaseStart?: (event: PhaseStartEvent) => Promise<void> | void;
  onPhaseEnd?: (event: PhaseEndEvent) => Promise<void> | void;
  /** Coarse progress reporting suitable for BullMQ job progress + WS notifications. */
  onProgress?: (event: ProgressEvent) => Promise<void> | void;
  /** Per-task updates emitted during literature + analysis polling. */
  onTaskUpdate?: (event: TaskUpdateEvent) => Promise<void> | void;
  onIterationComplete?: (event: IterationCompleteEvent) => Promise<void> | void;
  onError?: (event: { phase?: OrchestratorPhase; error: unknown }) => Promise<void> | void;
}
