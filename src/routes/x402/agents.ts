import { Elysia, t } from "elysia";
import { x402Middleware, type X402Settlement } from "../../middleware/x402/middleware";
import { create402Response } from "../../middleware/x402/service";
import { routePricing } from "../../middleware/x402/pricing";
import { authResolver } from "../../middleware/authResolver";
import logger from "../../utils/logger";
import type { Message, PlanTask, ConversationState, Discovery, State } from "../../types/core";

// Import agents
import { literatureAgent, type BioLiteratureMode } from "../../agents/literature";
import { hypothesisAgent } from "../../agents/hypothesis";
import { analysisAgent, type Dataset } from "../../agents/analysis";
import { discoveryAgent } from "../../agents/discovery";
import { reflectionAgent } from "../../agents/reflection";
import { planningAgent } from "../../agents/planning";
import { replyAgent } from "../../agents/reply";

/**
 * Helper to get x402Settlement from request
 */
function getX402Settlement(request: Request): X402Settlement | undefined {
  return (request as Request & { x402Settlement?: X402Settlement }).x402Settlement;
}

/**
 * Create a minimal Message object for agent input
 */
function createMessage(content: string, userId: string): Message {
  return {
    id: crypto.randomUUID(),
    userId,
    timestamp: new Date().toISOString(),
    content,
  };
}

/**
 * Create a minimal State for agent input
 */
function createState(userId: string): State {
  return {
    id: crypto.randomUUID(),
    values: {
      userId,
    },
  };
}

/**
 * Create a minimal ConversationState for agent input
 */
function createConversationState(
  userId: string,
  values: {
    objective?: string;
    currentHypothesis?: string;
    discoveries?: Discovery[];
  } = {}
): ConversationState {
  return {
    id: crypto.randomUUID(),
    userId,
    values: {
      objective: values.objective || "",
      ...values,
    },
  };
}

/**
 * Convert partial task data to PlanTask array
 */
function createCompletedTasks(
  tasks: Array<{ objective: string; output: string }>
): PlanTask[] {
  return tasks.map((t) => ({
    id: crypto.randomUUID(),
    objective: t.objective,
    output: t.output,
    status: "completed" as const,
  }));
}

/**
 * x402 V2 Agent Routes - Payment-gated access to individual BioAgents
 *
 * Each sub-agent can be called independently via x402 payment.
 * Simpler agents (literature, reply) work standalone.
 * Complex agents (hypothesis, discovery) need conversation context.
 * 
 * Pricing is defined centrally in src/middleware/x402/pricing.ts
 */

/**
 * Get available agent names from pricing config
 */
function getAgentPricing() {
  return routePricing
    .filter(p => p.route.startsWith("/api/x402/agents/"))
    .map(p => ({
      name: p.route.replace("/api/x402/agents/", ""),
      endpoint: p.route,
      priceUSD: p.priceUSD,
      description: p.description,
    }));
}

export const x402IndividualAgentsRoute = new Elysia({ prefix: "/api/x402/agents" })
  // List all available agents and their pricing
  .get("/", () => {
    return {
      agents: getAgentPricing(),
    };
  })

  // Apply x402 middleware to all agent routes
  .use(x402Middleware())
  .onBeforeHandle(authResolver({ required: false }))

  // =====================================================
  // LITERATURE AGENT - Standalone, simple input
  // =====================================================
  .get("/literature", ({ request }) => create402Response(request, "/api/x402/agents/literature"))
  .post("/literature", async ({ body, request, set }) => {
    const x402Settlement = getX402Settlement(request);
    if (!x402Settlement) return create402Response(request, "/api/x402/agents/literature");

    const { objective, type = "OPENSCHOLAR" } = body as {
      objective: string;
      type?: "OPENSCHOLAR" | "KNOWLEDGE" | "EDISON" | "BIOLIT" | "BIOLITDEEP";
    };

    if (!objective) {
      set.status = 400;
      return { error: "objective is required" };
    }

    try {
      const result = await literatureAgent({ objective, type });
      return {
        success: true,
        payer: x402Settlement.payer,
        transaction: x402Settlement.transaction,
        result,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "literature_agent_error");
      set.status = 500;
      return { error: error.message };
    }
  })

  // =====================================================
  // REPLY AGENT - Needs message context
  // =====================================================
  .get("/reply", ({ request }) => create402Response(request, "/api/x402/agents/reply"))
  .post("/reply", async ({ body, request, set }) => {
    const x402Settlement = getX402Settlement(request);
    if (!x402Settlement) return create402Response(request, "/api/x402/agents/reply");

    const { message, context = [], systemPrompt } = body as {
      message: string;
      context?: Array<{ role: "user" | "assistant"; content: string }>;
      systemPrompt?: string;
    };

    if (!message) {
      set.status = 400;
      return { error: "message is required" };
    }

    try {
      const userId = x402Settlement.payer || "x402-user";
      // Build complete input matching replyAgent signature
      const result = await replyAgent({
        conversationState: createConversationState(userId, { objective: message }),
        message: {
          id: crypto.randomUUID(),
          userId,
          timestamp: new Date().toISOString(),
          content: message,
        },
        completedMaxTasks: [], // No prior tasks in standalone x402 mode
        nextPlan: [], // No next plan in standalone mode
        isFinal: true,
      });

      return {
        success: true,
        payer: x402Settlement.payer,
        transaction: x402Settlement.transaction,
        result: {
          reply: result.reply,
          start: result.start,
          end: result.end,
        },
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "reply_agent_error");
      set.status = 500;
      return { error: error.message };
    }
  })

  // =====================================================
  // PLANNING AGENT - Creates research plans
  // =====================================================
  .get("/planning", ({ request }) => create402Response(request, "/api/x402/agents/planning"))
  .post("/planning", async ({ body, request, set }) => {
    const x402Settlement = getX402Settlement(request);
    if (!x402Settlement) return create402Response(request, "/api/x402/agents/planning");

    const { objective, existingPlan } = body as {
      objective: string;
      existingPlan?: any;
    };

    if (!objective) {
      set.status = 400;
      return { error: "objective is required" };
    }

    try {
      const userId = x402Settlement.payer || "x402-user";
      const conversationState = createConversationState(userId, {
        objective,
      });
      // If an existing plan was provided, add it to conversation state
      if (existingPlan) {
        conversationState.values.plan = existingPlan;
      }

      const result = await planningAgent({
        state: createState(userId),
        conversationState,
        message: {
          id: crypto.randomUUID(),
          userId,
          timestamp: new Date().toISOString(),
          content: objective,
        },
        mode: existingPlan ? "next" : "initial",
      });

      return {
        success: true,
        payer: x402Settlement.payer,
        transaction: x402Settlement.transaction,
        result,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "planning_agent_error");
      set.status = 500;
      return { error: error.message };
    }
  })

  // =====================================================
  // HYPOTHESIS AGENT - Needs research context
  // =====================================================
  .get("/hypothesis", ({ request }) => create402Response(request, "/api/x402/agents/hypothesis"))
  .post("/hypothesis", async ({ body, request, set }) => {
    const x402Settlement = getX402Settlement(request);
    if (!x402Settlement) return create402Response(request, "/api/x402/agents/hypothesis");

    const { objective, completedTasks = [], currentHypothesis } = body as {
      objective: string;
      completedTasks?: Array<{
        id: string;
        type: string;
        objective: string;
        output?: string;
      }>;
      currentHypothesis?: string;
    };

    if (!objective) {
      set.status = 400;
      return { error: "objective is required" };
    }

    try {
      const result = await hypothesisAgent({
        objective,
        message: {
          id: crypto.randomUUID(),
          userId: x402Settlement.payer || "x402-user",
          timestamp: new Date().toISOString(),
          content: objective,
        },
        conversationState: createConversationState(
          x402Settlement.payer || "x402-user",
          { currentHypothesis, discoveries: [] }
        ),
        completedTasks: createCompletedTasks(completedTasks),
      });

      return {
        success: true,
        payer: x402Settlement.payer,
        transaction: x402Settlement.transaction,
        result,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "hypothesis_agent_error");
      set.status = 500;
      return { error: error.message };
    }
  })

  // =====================================================
  // ANALYSIS AGENT - Needs datasets
  // =====================================================
  .get("/analysis", ({ request }) => create402Response(request, "/api/x402/agents/analysis"))
  .post("/analysis", async ({ body, request, set }) => {
    const x402Settlement = getX402Settlement(request);
    if (!x402Settlement) return create402Response(request, "/api/x402/agents/analysis");

    const { objective, datasets, type = "BIO" } = body as {
      objective: string;
      datasets: Array<{ filename: string; id: string; description: string; content?: string }>;
      type?: "EDISON" | "BIO";
    };

    if (!objective) {
      set.status = 400;
      return { error: "objective is required" };
    }

    if (!datasets || datasets.length === 0) {
      set.status = 400;
      return { error: "datasets array is required" };
    }

    try {
      // Convert base64 content to Buffer if provided
      const processedDatasets: Dataset[] = datasets.map((d) => ({
        filename: d.filename,
        id: d.id,
        description: d.description,
        content: d.content ? Buffer.from(d.content, "base64") : undefined,
      }));

      const result = await analysisAgent({
        objective,
        datasets: processedDatasets,
        type,
        userId: x402Settlement.payer || "x402-user",
        conversationStateId: crypto.randomUUID(),
      });

      return {
        success: true,
        payer: x402Settlement.payer,
        transaction: x402Settlement.transaction,
        result,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "analysis_agent_error");
      set.status = 500;
      return { error: error.message };
    }
  })

  // =====================================================
  // REFLECTION AGENT - Evaluates research
  // =====================================================
  .get("/reflection", ({ request }) => create402Response(request, "/api/x402/agents/reflection"))
  .post("/reflection", async ({ body, request, set }) => {
    const x402Settlement = getX402Settlement(request);
    if (!x402Settlement) return create402Response(request, "/api/x402/agents/reflection");

    const { objective, hypothesis, discoveries = [], completedTasks = [] } = body as {
      objective: string;
      hypothesis?: string;
      discoveries?: Array<{ title: string; summary: string; evidence?: string[] }>;
      completedTasks?: Array<{ type: string; objective: string; output?: string }>;
    };

    if (!objective) {
      set.status = 400;
      return { error: "objective is required" };
    }

    try {
      const userId = x402Settlement.payer || "x402-user";
      const result = await reflectionAgent({
        conversationState: createConversationState(userId, {
          objective,
          currentHypothesis: hypothesis,
          discoveries: discoveries as Discovery[],
        }),
        message: {
          id: crypto.randomUUID(),
          userId,
          timestamp: new Date().toISOString(),
          content: objective,
        },
        completedMaxTasks: createCompletedTasks(completedTasks),
        hypothesis,
      });

      return {
        success: true,
        payer: x402Settlement.payer,
        transaction: x402Settlement.transaction,
        result,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "reflection_agent_error");
      set.status = 500;
      return { error: error.message };
    }
  })

  // =====================================================
  // DISCOVERY AGENT - Extracts discoveries
  // =====================================================
  .get("/discovery", ({ request }) => create402Response(request, "/api/x402/agents/discovery"))
  .post("/discovery", async ({ body, request, set }) => {
    const x402Settlement = getX402Settlement(request);
    if (!x402Settlement) return create402Response(request, "/api/x402/agents/discovery");

    const { hypothesis, completedTasks = [], existingDiscoveries = [] } = body as {
      hypothesis?: string;
      completedTasks: Array<{
        id: string;
        type: string;
        objective: string;
        output?: string;
      }>;
      existingDiscoveries?: Array<{ title: string; summary: string }>;
    };

    if (!completedTasks || completedTasks.length === 0) {
      set.status = 400;
      return { error: "completedTasks array is required" };
    }

    try {
      const result = await discoveryAgent({
        message: {
          id: crypto.randomUUID(),
          userId: x402Settlement.payer || "x402-user",
          timestamp: new Date().toISOString(),
          content: "",
        },
        conversationState: createConversationState(
          x402Settlement.payer || "x402-user",
          { discoveries: existingDiscoveries as Discovery[] }
        ),
        tasksToConsider: createCompletedTasks(completedTasks),
        hypothesis,
      });

      return {
        success: true,
        payer: x402Settlement.payer,
        transaction: x402Settlement.transaction,
        result,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, "discovery_agent_error");
      set.status = 500;
      return { error: error.message };
    }
  });
