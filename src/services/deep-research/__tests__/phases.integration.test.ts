/**
 * End-to-end smoke test for the shared deep-research phases.
 *
 * Exercises the full phase chain (planning -> hypothesis ->
 * reflection-discovery -> next-steps -> continue-decision -> reply) against
 * a real Supabase database, with all DR agents stubbed via the E1 helpers
 * in `src/utils/__testHelpers__/deepResearch.ts`.
 *
 * Execution phase is exercised in `execution.test.ts` (unit) — including
 * it here would require stubbing the literature + analysis fan-out
 * end-to-end, which adds little signal over the per-phase coverage already
 * in place. We seed completed LITERATURE tasks to give the downstream
 * phases something to chew on.
 *
 * Real services: Supabase (CLI-managed local stack). Mocked: every agent
 * function in the DR pipeline.
 */

import { afterEach, beforeAll, expect, test } from "bun:test";
import type { ConversationState, Message, PlanTask, State } from "../../../types/core";
import {
  cleanupDeepResearchRun,
  type DeepResearchSeed,
  makeContinueResearchAgent,
  makeDiscoveryAgent,
  makeHypothesisAgent,
  makePlanningAgent,
  makeReflectionAgent,
  makeReplyAgent,
  readConversationStateValues,
  readMessageRow,
  seedDeepResearchRun,
} from "../../../utils/__testHelpers__/deepResearch";
import { describeIfSupabase } from "../../../utils/__testHelpers__/integrationEnv";

describeIfSupabase("[integration] deep-research phases end-to-end", () => {
  let runHypothesisPhase: typeof import("../phases/hypothesis").runHypothesisPhase;
  let runReflectionDiscoveryPhase: typeof import("../phases/reflection-discovery").runReflectionDiscoveryPhase;
  let runNextStepsPhase: typeof import("../phases/next-steps").runNextStepsPhase;
  let runContinueDecisionPhase: typeof import("../phases/continue-decision").runContinueDecisionPhase;
  let runReplyPhase: typeof import("../phases/reply").runReplyPhase;
  let runPlanningPhase: typeof import("../phases/planning").runPlanningPhase;
  let getServiceClient: typeof import("../../../db/client").getServiceClient;

  beforeAll(async () => {
    ({ runHypothesisPhase } = await import("../phases/hypothesis"));
    ({ runReflectionDiscoveryPhase } = await import("../phases/reflection-discovery"));
    ({ runNextStepsPhase } = await import("../phases/next-steps"));
    ({ runContinueDecisionPhase } = await import("../phases/continue-decision"));
    ({ runReplyPhase } = await import("../phases/reply"));
    ({ runPlanningPhase } = await import("../phases/planning"));
    ({ getServiceClient } = await import("../../../db/client"));
  });

  let seed: DeepResearchSeed | null = null;

  afterEach(async () => {
    if (seed) {
      await cleanupDeepResearchRun(seed);
      seed = null;
    }
  });

  test("phase chain mutates conversation state and message row as expected (single iteration)", async () => {
    seed = await seedDeepResearchRun({
      conversationStateValues: {
        objective: "Investigate rapamycin and lifespan",
        plan: [],
      } as ConversationState["values"],
      question: "Investigate rapamycin and lifespan",
    });

    const messageRow = await readMessageRow(seed.messageId);
    const message: Message = {
      content: messageRow.content ?? "",
      conversation_id: seed.conversationId,
      id: seed.messageId,
      question: messageRow.question ?? "Investigate rapamycin and lifespan",
      user_id: seed.userId,
    };
    const state: State = { id: seed.stateId, values: { userId: seed.userId } };

    // In-memory conversation state mirror — phases mutate this and persist
    // via the supplied callback, which writes back to Supabase.
    const conversationState: ConversationState = {
      id: seed.conversationStateId,
      values: (await readConversationStateValues(seed.conversationStateId)) ?? {
        objective: "Investigate rapamycin and lifespan",
      },
    };

    // Inline persist callbacks that talk to supabase directly — avoids
    // db/operations / chat-tools entirely, which other tests have polluted
    // with partial mock.module replacements that survive process-globally
    // and would crash this file's beforeAll.
    const supabase = getServiceClient();
    const persistConversationState = async () => {
      await supabase
        .from("conversation_states")
        .update({ values: conversationState.values })
        .eq("id", conversationState.id!);
    };
    const persistConversationActivity = persistConversationState;
    const markMessageComplete = async (
      id: string,
      updates: { content: string; response_time: number; summary?: string }
    ) => {
      const { data } = await supabase
        .from("messages")
        .update({ ...updates, status: "COMPLETE" })
        .eq("id", id)
        .eq("status", "PENDING")
        .select("id");
      return { updated: (data?.length ?? 0) > 0 };
    };
    const getObjectiveTraceObjective = (_v: ConversationState["values"], fb?: string) => fb;
    const assertNotCancelled = async () => undefined;

    // Phase 1: planning (default path — uses stubbed agent).
    const planning = await runPlanningPhase(
      {
        conversationState,
        currentMessage: message,
        iterationCount: 1,
        researchMode: "steering",
        rootMessage: message,
        skipPlanning: false,
        state,
      },
      {
        assertNotCancelled,
        getObjectiveTraceObjective,
        persistConversationState,
        planningAgent: makePlanningAgent() as unknown as Parameters<
          typeof runPlanningPhase
        >[1]["planningAgent"],
      }
    );
    expect(planning.newLevel).toBe(0);
    expect(conversationState.values.plan?.length).toBeGreaterThan(0);

    // Pre-seed task output so reflection/reply have something to summarise
    // without actually running the execution phase (which is unit-tested).
    const completedTasks: PlanTask[] = (conversationState.values.plan ?? []).map((t) => ({
      ...t,
      end: new Date().toISOString(),
      output: `Stub literature output for ${t.objective}`,
      start: new Date().toISOString(),
    }));
    conversationState.values.plan = completedTasks;
    await persistConversationState();

    // Phase 2: hypothesis.
    const hypothesis = await runHypothesisPhase(
      {
        completedTasks,
        conversationState,
        message,
        objective: planning.currentObjective,
      },
      {
        assertNotCancelled,
        hypothesisAgent: makeHypothesisAgent({
          hypothesis: "Rapamycin extends lifespan via mTOR.",
        }),
        persistConversationState,
      }
    );
    expect(hypothesis.hypothesis).toBe("Rapamycin extends lifespan via mTOR.");

    // Phase 3: reflection + discovery.
    await runReflectionDiscoveryPhase(
      {
        completedTasks,
        conversationState,
        hypothesis: hypothesis.hypothesis,
        message,
      },
      {
        assertNotCancelled,
        discoveryAgent: makeDiscoveryAgent(),
        getDiscoveryRunConfig: () => ({ shouldRunDiscovery: false, tasksToConsider: [] }),
        getMessagesByConversation: async () => [{ id: seed!.messageId }],
        getObjectiveTraceObjective,
        persistConversationState,
        reflectionAgent: makeReflectionAgent({
          conversationTitle: "Rapamycin / Lifespan",
          currentObjective: "Mechanism narrowed to mTORC1",
          evolvingObjective: "Rapamycin's lifespan effect via mTORC1",
          keyInsights: ["mTORC1 inhibition extends lifespan", "Side-effect profile matters"],
          methodology: "Synthesis of literature stubs",
        }) as unknown as Parameters<typeof runReflectionDiscoveryPhase>[1]["reflectionAgent"],
      }
    );

    // Phase 4: next-steps.
    const nextSteps = await runNextStepsPhase(
      {
        conversationState,
        currentObjective: planning.currentObjective,
        message,
        newLevel: planning.newLevel,
        researchMode: "steering",
        state,
      },
      {
        assertNotCancelled,
        getObjectiveTraceObjective,
        persistConversationActivity,
        persistConversationState,
        // Override currentObjective to match reflection's output so the
        // next-steps overwrite doesn't change it — keeps assertions clean.
        planningAgent: makePlanningAgent({
          currentObjective: "Mechanism narrowed to mTORC1",
        }) as unknown as Parameters<typeof runNextStepsPhase>[1]["planningAgent"],
      }
    );
    expect(nextSteps.hasSuggestions).toBe(true);

    // Phase 5: continue-decision.
    const decision = await runContinueDecisionPhase(
      {
        completedTasks,
        conversationState,
        hypothesis: hypothesis.hypothesis,
        iterationCount: 1,
        loopAlive: true,
        maxAutoIterations: 1, // steering mode caps at 1
        message,
        researchMode: "steering",
      },
      {
        assertNotCancelled,
        // Even if the agent says continue, the cap halts the loop.
        continueResearchAgent: makeContinueResearchAgent({ shouldContinue: true }),
      }
    );
    expect(decision.shouldContinueLoop).toBe(false); // iteration cap == 1
    expect(decision.isFinal).toBe(true);

    // Phase 6: reply (also writes to message row).
    const reply = await runReplyPhase(
      {
        conversationState,
        currentMessage: message,
        currentObjective: planning.currentObjective,
        hypothesis: hypothesis.hypothesis,
        isFinal: decision.isFinal,
        iterationCount: 1,
        iterationStartTime: Date.now() - 100,
        newLevel: planning.newLevel,
        sessionStartLevel: 0,
        state,
      },
      {
        assertNotCancelled,
        markMessageComplete,
        notifyMessageUpdated: async () => undefined,
        persistConversationActivity,
        persistConversationState,
        replyAgent: makeReplyAgent({ reply: "Final assembled reply.", summary: "summary" }),
      }
    );
    expect(reply.updated).toBe(true);

    // Assertions against the real DB
    const finalState = await readConversationStateValues(seed.conversationStateId);
    expect(finalState?.currentHypothesis).toBe("Rapamycin extends lifespan via mTOR.");
    expect(finalState?.currentObjective).toBe("Mechanism narrowed to mTORC1");
    expect(finalState?.keyInsights).toEqual([
      "mTORC1 inhibition extends lifespan",
      "Side-effect profile matters",
    ]);
    expect(finalState?.methodology).toBe("Synthesis of literature stubs");
    expect(finalState?.finalResponse).toBe("Final assembled reply.");
    expect(finalState?.suggestedNextSteps?.length).toBeGreaterThan(0);

    const finalMessage = await readMessageRow(seed.messageId);
    expect(finalMessage.content).toBe("Final assembled reply.");
    expect(finalMessage.status).toBe("COMPLETE");
  });
});
