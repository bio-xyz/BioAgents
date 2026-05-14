/**
 * Test helpers for the deep-research orchestrator integration suite.
 *
 * Composition pattern: tests import the agent mock factories from here and
 * call `mock.module()` themselves with the import path relative to the test
 * file. The helper centralizes WHAT the mocks return (deterministic, varying
 * by objective so multi-iteration tests can detect propagation) — each test
 * decides which agents to mock and where to install them.
 *
 * Real services we rely on (per the BIOS-80 testing strategy):
 * - Supabase (local container via `supabase start`) for DB writes, RPC calls.
 * - Redis (Docker) for BullMQ semantics in the queue path.
 *
 * Mocked because real calls are flaky/costly/non-deterministic and the
 * mocks faithfully reproduce the shape the orchestrator consumes:
 * - LLM providers, planning/literature/analysis/hypothesis/reflection/
 *   discovery/continueResearch/reply agents, external services like
 *   Edison/OpenScholar/BioLit.
 */

import type {
  ConversationStateValues,
  Discovery,
  Message,
  PlanTask,
  PlanTaskType,
  ProteinStructure,
} from "../../types/core";
import { generateUUID } from "../uuid";

// ---------------------------------------------------------------------------
// Seed / cleanup
// ---------------------------------------------------------------------------

export interface DeepResearchSeed {
  userId: string;
  conversationId: string;
  conversationStateId: string;
  stateId: string;
  messageId: string;
  /** Tracks every messageId created in this run so cleanup deletes them all. */
  extraMessageIds: string[];
}

export interface SeedDeepResearchRunOptions {
  userId?: string;
  conversationId?: string;
  question?: string;
  /** Initial conversation-state values (objective, plan, etc.). Empty by default. */
  conversationStateValues?: Partial<ConversationStateValues>;
}

/**
 * Insert user + conversation + conversation_state + state + message rows
 * via the supabase service client DIRECTLY.
 *
 * We deliberately bypass `db/operations` because other test files in the
 * suite install partial `mock.module("db/operations", …)` replacements that
 * persist process-globally — bun:test's `mock.restore()` only restores
 * spies, not module mocks, so any test running AFTER one of those would
 * see a mocked db layer missing `createMessage` etc. and crash here.
 * Going straight to the supabase client side-steps the global mock.
 */
export async function seedDeepResearchRun(
  opts: SeedDeepResearchRunOptions = {}
): Promise<DeepResearchSeed> {
  const { getServiceClient } = await import("../../db/client");
  const supabase = getServiceClient();

  const userId = opts.userId ?? generateUUID();
  const conversationId = opts.conversationId ?? generateUUID();
  const question = opts.question ?? "What does the literature say about rapamycin and lifespan?";

  // 1. User
  {
    const { error } = await supabase.from("users").upsert(
      {
        email: `${userId}@temp.local`,
        id: userId,
        username: `user_${userId.slice(0, 8)}`,
      },
      { ignoreDuplicates: true, onConflict: "id" }
    );
    if (error && error.code !== "23505") {
      throw new Error(`users insert failed: ${error.message}`);
    }
  }

  // 2. Conversation
  {
    const { error } = await supabase
      .from("conversations")
      .insert({ id: conversationId, user_id: userId });
    if (error) throw new Error(`conversations insert failed: ${error.message}`);
  }

  // 3. Conversation state
  const { data: csData, error: csError } = await supabase
    .from("conversation_states")
    .insert({
      values: {
        objective: question,
        ...opts.conversationStateValues,
      },
    })
    .select("id")
    .single();
  if (csError || !csData) {
    throw new Error(`conversation_states insert failed: ${csError?.message}`);
  }
  const conversationStateId = csData.id as string;

  {
    const { error } = await supabase
      .from("conversations")
      .update({ conversation_state_id: conversationStateId })
      .eq("id", conversationId);
    if (error)
      throw new Error(`conversations.conversation_state_id update failed: ${error.message}`);
  }

  // 4. State (per-message agent state)
  const { data: stateData, error: stateError } = await supabase
    .from("states")
    .insert({ values: { userId } })
    .select("id")
    .single();
  if (stateError || !stateData) {
    throw new Error(`states insert failed: ${stateError?.message}`);
  }
  const stateId = stateData.id as string;

  // 5. Initial user message
  const { data: msgData, error: msgError } = await supabase
    .from("messages")
    .insert({
      content: "",
      conversation_id: conversationId,
      question,
      state_id: stateId,
      status: "PENDING",
      user_id: userId,
    })
    .select("id")
    .single();
  if (msgError || !msgData) {
    throw new Error(`messages insert failed: ${msgError?.message}`);
  }

  return {
    conversationId,
    conversationStateId,
    extraMessageIds: [],
    messageId: msgData.id as string,
    stateId,
    userId,
  };
}

/**
 * Delete in FK-safe order: messages -> states -> conversation_state ->
 * conversation -> user. Throws if any deletion errors so a flaky cleanup
 * surfaces explicitly instead of leaking rows into the next run.
 */
export async function cleanupDeepResearchRun(seed: DeepResearchSeed): Promise<void> {
  const { getServiceClient } = await import("../../db/client");
  const supabase = getServiceClient();

  const allMessageIds = [seed.messageId, ...seed.extraMessageIds].filter(Boolean);

  if (allMessageIds.length > 0) {
    const { error } = await supabase.from("messages").delete().in("id", allMessageIds);
    if (error) throw new Error(`messages cleanup failed: ${error.message}`);
  }

  if (seed.stateId) {
    const { error } = await supabase.from("states").delete().eq("id", seed.stateId);
    if (error) throw new Error(`states cleanup failed: ${error.message}`);
  }

  if (seed.conversationId) {
    const { error } = await supabase.from("conversations").delete().eq("id", seed.conversationId);
    if (error) throw new Error(`conversations cleanup failed: ${error.message}`);
  }

  if (seed.conversationStateId) {
    const { error } = await supabase
      .from("conversation_states")
      .delete()
      .eq("id", seed.conversationStateId);
    if (error) throw new Error(`conversation_states cleanup failed: ${error.message}`);
  }

  if (seed.userId) {
    const { error } = await supabase.from("users").delete().eq("id", seed.userId);
    if (error) throw new Error(`users cleanup failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function readConversationStateValues(
  conversationStateId: string
): Promise<ConversationStateValues | null> {
  const { getServiceClient } = await import("../../db/client");
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("conversation_states")
    .select("values")
    .eq("id", conversationStateId)
    .single();
  if (error) throw new Error(`conversation_states select failed: ${error.message}`);
  return (data?.values ?? null) as ConversationStateValues | null;
}

export async function readMessageRow(messageId: string) {
  // Bypass db/operations for the same reason as seed (see above).
  const { getServiceClient } = await import("../../db/client");
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("messages").select("*").eq("id", messageId).single();
  if (error) throw new Error(`messages select failed: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Agent mock factories
//
// Each factory returns an async function with the same signature as the real
// agent. The returned function produces deterministic output that varies by
// input (typically by `objective`) so multi-iteration tests can verify state
// propagated correctly between iterations rather than passing vacuously on
// identical canned output.
// ---------------------------------------------------------------------------

function suffix(objective: string): string {
  // Short deterministic suffix; lets multi-iteration tests assert
  // outputs trace back to the right iteration's objective.
  const hash = objective
    .split("")
    .reduce((acc, ch) => ((acc * 31 + ch.charCodeAt(0)) >>> 0) % 100000, 7);
  return String(hash).padStart(5, "0");
}

export interface PlanningAgentMockOpts {
  /** Tasks the agent returns. Default: one LITERATURE task echoing the input objective. */
  plan?: PlanTask[];
  /** Current objective on the result. Default: input message question or a stub. */
  currentObjective?: string;
}

export function makePlanningAgent(opts: PlanningAgentMockOpts = {}) {
  return async (input: {
    state: { id: string; values: { userId?: string } };
    conversationState: { id?: string; values: ConversationStateValues };
    message: Message;
    mode?: "initial" | "next";
  }) => {
    const objective =
      opts.currentObjective ??
      input.conversationState.values.objective ??
      input.message.question ??
      "stub-objective";
    const tag = suffix(objective);

    const plan: PlanTask[] =
      opts.plan ??
      (input.mode === "next"
        ? [
            // "next" mode returns suggestions for the next iteration. Tests
            // can override to return [] to stop the loop.
            {
              datasets: [],
              id: `lit-next-${tag}`,
              objective: `Next-iteration lookup for ${objective}`,
              type: "LITERATURE" as PlanTaskType,
            },
          ]
        : [
            {
              datasets: [],
              id: `lit-1-${tag}`,
              objective,
              type: "LITERATURE" as PlanTaskType,
            },
          ]);

    return { currentObjective: objective, plan };
  };
}

export interface LiteratureAgentMockOpts {
  /** Override output. Default: synthesised from objective + type. */
  output?: string;
  /** Protein structures to attach. Default: none. */
  proteinStructures?: ProteinStructure[];
}

export function makeLiteratureAgent(opts: LiteratureAgentMockOpts = {}) {
  return async (input: { objective: string; type: string; sources?: string[] }) => ({
    count: 1,
    end: new Date().toISOString(),
    output:
      opts.output ??
      `[${input.type}] result for "${input.objective}" (#${suffix(input.objective)})`,
    proteinStructures: opts.proteinStructures,
    start: new Date().toISOString(),
  });
}

export interface AnalysisAgentMockOpts {
  output?: string;
}

export function makeAnalysisAgent(opts: AnalysisAgentMockOpts = {}) {
  return async (input: { objective: string }) => ({
    artifacts: [],
    end: new Date().toISOString(),
    output: opts.output ?? `analysis result for "${input.objective}" (#${suffix(input.objective)})`,
    reasoning: ["stub analysis reasoning"],
    start: new Date().toISOString(),
  });
}

export interface HypothesisAgentMockOpts {
  hypothesis?: string;
  mode?: "create" | "update";
}

export function makeHypothesisAgent(opts: HypothesisAgentMockOpts = {}) {
  return async (input: {
    objective: string;
    conversationState: { values: ConversationStateValues };
  }) => ({
    end: new Date().toISOString(),
    hypothesis:
      opts.hypothesis ?? `hypothesis for "${input.objective}" (#${suffix(input.objective)})`,
    mode: opts.mode ?? (input.conversationState.values.currentHypothesis ? "update" : "create"),
    start: new Date().toISOString(),
  });
}

export interface ReflectionAgentMockOpts {
  conversationTitle?: string;
  currentObjective?: string;
  evolvingObjective?: string;
  keyInsights?: string[];
  methodology?: string;
}

export function makeReflectionAgent(opts: ReflectionAgentMockOpts = {}) {
  return async (input: {
    hypothesis: string;
    conversationState: { values: ConversationStateValues };
  }) => {
    const seed = suffix(input.hypothesis);
    return {
      conversationTitle: opts.conversationTitle ?? `Conversation #${seed}`,
      currentObjective:
        opts.currentObjective ??
        input.conversationState.values.currentObjective ??
        `objective-${seed}`,
      end: new Date().toISOString(),
      evolvingObjective: opts.evolvingObjective ?? `evolving-${seed}`,
      keyInsights: opts.keyInsights ?? [`Insight A #${seed}`, `Insight B #${seed}`],
      methodology: opts.methodology ?? "Stubbed methodology",
      start: new Date().toISOString(),
    };
  };
}

export interface DiscoveryAgentMockOpts {
  discoveries?: Discovery[];
}

export function makeDiscoveryAgent(opts: DiscoveryAgentMockOpts = {}) {
  return async (input: { conversationState: { values: ConversationStateValues } }) => ({
    discoveries: opts.discoveries ?? input.conversationState.values.discoveries ?? [],
    end: new Date().toISOString(),
    start: new Date().toISOString(),
  });
}

export interface ContinueResearchAgentMockOpts {
  shouldContinue?: boolean;
  confidence?: "high" | "medium" | "low";
  reasoning?: string;
}

export function makeContinueResearchAgent(opts: ContinueResearchAgentMockOpts = {}) {
  return async (_input: { iterationCount: number }) => ({
    confidence: opts.confidence ?? "high",
    end: new Date().toISOString(),
    reasoning: opts.reasoning ?? "Stubbed continue-research decision.",
    shouldContinue: opts.shouldContinue ?? false,
    start: new Date().toISOString(),
  });
}

export interface ReplyAgentMockOpts {
  reply?: string;
  summary?: string;
}

export function makeReplyAgent(opts: ReplyAgentMockOpts = {}) {
  return async (input: { message: Message }) => {
    const tag = suffix(input.message.question ?? "no-question");
    return {
      end: new Date().toISOString(),
      reply: opts.reply ?? `Stub reply for "${input.message.question}" (#${tag})`,
      start: new Date().toISOString(),
      summary: opts.summary ?? `Stub summary #${tag}`,
    };
  };
}
