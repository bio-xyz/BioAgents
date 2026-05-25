/**
 * Reflection + Discovery phase of a single deep-research iteration.
 *
 * Reflection always runs; discovery runs only when getDiscoveryRunConfig
 * approves it (based on message count, plan shape, and the current
 * iteration's tasks). They fan out in parallel, then their results are
 * applied to conversation state in a single persist.
 */

import type {
  ConversationState,
  ConversationStateValues,
  Discovery,
  Message,
  PlanTask,
} from "../../../types/core";
import logger from "../../../utils/logger";

export interface ReflectionDiscoveryPhaseInput {
  completedTasks: PlanTask[];
  conversationState: ConversationState;
  message: Message;
  hypothesis: string;
}

export interface ReflectionAgentResult {
  conversationTitle?: string;
  evolvingObjective?: string;
  currentObjective?: string;
  keyInsights: string[];
  methodology?: string;
  start: string;
  end: string;
}

export interface DiscoveryAgentResult {
  discoveries: Discovery[];
  start: string;
  end: string;
}

export interface DiscoveryRunConfig {
  shouldRunDiscovery: boolean;
  tasksToConsider: PlanTask[];
}

export interface ReflectionDiscoveryPhaseDeps {
  assertNotCancelled: () => Promise<void>;
  persistConversationState: (options?: { ensureTraceObjective?: string }) => Promise<void>;
  getObjectiveTraceObjective: (
    values: ConversationStateValues,
    fallback?: string
  ) => string | undefined;
  /** Optional overrides — defaults dynamically import the real modules. */
  reflectionAgent?: (input: {
    completedMaxTasks: PlanTask[];
    conversationState: ConversationState;
    message: Message;
    hypothesis?: string;
  }) => Promise<ReflectionAgentResult>;
  discoveryAgent?: (input: {
    conversationState: ConversationState;
    message: Message;
    tasksToConsider: PlanTask[];
    hypothesis?: string;
  }) => Promise<DiscoveryAgentResult>;
  getMessagesByConversation?: (
    conversationId: string,
    limit?: number
  ) => Promise<Array<unknown> | null>;
  getDiscoveryRunConfig?: (
    messageCount: number,
    plan: PlanTask[],
    tasksToExecute: PlanTask[]
  ) => DiscoveryRunConfig;
}

export interface ReflectionDiscoveryPhaseResult {
  reflectionResult: ReflectionAgentResult;
  discoveryResult: DiscoveryAgentResult | null;
}

export async function runReflectionDiscoveryPhase(
  input: ReflectionDiscoveryPhaseInput,
  deps: ReflectionDiscoveryPhaseDeps
): Promise<ReflectionDiscoveryPhaseResult> {
  await deps.assertNotCancelled();
  logger.info("running_reflection_and_discovery_agents");

  const reflectionAgent =
    deps.reflectionAgent ?? (await import("../../../agents/reflection")).reflectionAgent;
  const discoveryAgent =
    deps.discoveryAgent ?? (await import("../../../agents/discovery")).discoveryAgent;
  const getMessagesByConversation =
    deps.getMessagesByConversation ??
    (await import("../../../db/operations")).getMessagesByConversation;
  const getDiscoveryRunConfig =
    deps.getDiscoveryRunConfig ?? (await import("../../../utils/discovery")).getDiscoveryRunConfig;

  // Determine whether discovery should run this iteration.
  let shouldRunDiscovery = false;
  let tasksToConsider: PlanTask[] = [];
  if (input.message.conversation_id) {
    const allMessages = await getMessagesByConversation(input.message.conversation_id, 100);
    const messageCount = allMessages?.length || 1;
    const config = getDiscoveryRunConfig(
      messageCount,
      input.conversationState.values.plan || [],
      input.completedTasks
    );
    shouldRunDiscovery = config.shouldRunDiscovery;
    tasksToConsider = config.tasksToConsider;
  }

  const [reflectionResult, discoveryResult] = await Promise.all([
    reflectionAgent({
      completedMaxTasks: input.completedTasks,
      conversationState: input.conversationState,
      hypothesis: input.hypothesis,
      message: input.message,
    }),
    shouldRunDiscovery
      ? discoveryAgent({
          conversationState: input.conversationState,
          hypothesis: input.hypothesis,
          message: input.message,
          tasksToConsider,
        })
      : Promise.resolve(null),
  ]);

  // Apply reflection mutations
  input.conversationState.values.conversationTitle = reflectionResult.conversationTitle;
  if (reflectionResult.evolvingObjective) {
    input.conversationState.values.evolvingObjective = reflectionResult.evolvingObjective;
  }
  input.conversationState.values.currentObjective = reflectionResult.currentObjective;
  input.conversationState.values.keyInsights = reflectionResult.keyInsights;
  input.conversationState.values.methodology = reflectionResult.methodology;

  // Apply discovery mutations when discovery ran
  if (discoveryResult) {
    input.conversationState.values.discoveries = discoveryResult.discoveries;
    logger.info({ discoveryCount: discoveryResult.discoveries.length }, "discoveries_updated");
  }

  if (input.conversationState.id) {
    await deps.persistConversationState({
      ensureTraceObjective: deps.getObjectiveTraceObjective(
        input.conversationState.values,
        reflectionResult.currentObjective
      ),
    });
    logger.info(
      {
        currentObjective: reflectionResult.currentObjective,
        discoveries: input.conversationState.values.discoveries?.length || 0,
        insights: reflectionResult.keyInsights,
      },
      "world_state_updated_via_reflection_and_discovery"
    );
  }

  return { discoveryResult, reflectionResult };
}
