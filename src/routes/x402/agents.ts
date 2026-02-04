import { Elysia, t } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { x402Service } from "../../middleware/x402/service";
import { authResolver } from "../../middleware/authResolver";
import logger from "../../utils/logger";

// Import agents
import { literatureAgent, type BioLiteratureMode } from "../../agents/literature";
import { hypothesisAgent } from "../../agents/hypothesis";
import { analysisAgent, type Dataset } from "../../agents/analysis";
import { discoveryAgent } from "../../agents/discovery";
import { reflectionAgent } from "../../agents/reflection";
import { planningAgent } from "../../agents/planning";
import { replyAgent } from "../../agents/reply";

/**
 * x402 V2 Agent Routes - Payment-gated access to individual BioAgents
 *
 * Each sub-agent can be called independently via x402 payment.
 * Simpler agents (literature, reply) work standalone.
 * Complex agents (hypothesis, discovery) need conversation context.
 */

// Agent pricing configuration
const agentPricing: Record<string, { priceUSD: string; description: string }> = {
  literature: {
    priceUSD: "0.01",
    description: "Literature search agent - searches scientific papers and knowledge bases",
  },
  reply: {
    priceUSD: "0.01",
    description: "Reply agent - generates AI responses based on context",
  },
  hypothesis: {
    priceUSD: "0.02",
    description: "Hypothesis agent - generates scientific hypotheses from research",
  },
  analysis: {
    priceUSD: "0.025",
    description: "Analysis agent - performs data analysis on datasets",
  },
  discovery: {
    priceUSD: "0.02",
    description: "Discovery agent - extracts scientific discoveries from research",
  },
  reflection: {
    priceUSD: "0.015",
    description: "Reflection agent - evaluates and reflects on research progress",
  },
  planning: {
    priceUSD: "0.01",
    description: "Planning agent - creates research plans and task breakdowns",
  },
};

/**
 * Generate 402 response for an agent
 */
function generate402Response(request: Request, agentName: string) {
  const pricing = agentPricing[agentName];
  if (!pricing) {
    return new Response(JSON.stringify({ error: `Unknown agent: ${agentName}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto || url.protocol.replace(":", "");
  const resourceUrl = `${protocol}://${url.host}/api/x402/agents/${agentName}`;

  const paymentRequired = x402Service.generatePaymentRequired(
    resourceUrl,
    pricing.description,
    pricing.priceUSD,
    { includeOutputSchema: true }
  );

  // Encode for v2 clients that expect PAYMENT-REQUIRED header
  const paymentRequiredHeader = x402Service.encodePaymentRequiredHeader(paymentRequired);

  return new Response(JSON.stringify(paymentRequired), {
    status: 402,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "PAYMENT-REQUIRED": paymentRequiredHeader,
    },
  });
}

export const x402AgentsRoute = new Elysia({ prefix: "/api/x402/agents" })
  // List all available agents and their pricing
  .get("/", () => {
    return {
      agents: Object.entries(agentPricing).map(([name, info]) => ({
        name,
        endpoint: `/api/x402/agents/${name}`,
        ...info,
      })),
    };
  })

  // Apply x402 middleware to all agent routes
  .use(x402Middleware())
  .onBeforeHandle(authResolver({ required: false }))

  // =====================================================
  // LITERATURE AGENT - Standalone, simple input
  // =====================================================
  .get("/literature", ({ request }) => generate402Response(request, "literature"))
  .post("/literature", async ({ body, request, set }) => {
    const x402Settlement = (request as any).x402Settlement;
    if (!x402Settlement) return generate402Response(request, "literature");

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
  .get("/reply", ({ request }) => generate402Response(request, "reply"))
  .post("/reply", async ({ body, request, set }) => {
    const x402Settlement = (request as any).x402Settlement;
    if (!x402Settlement) return generate402Response(request, "reply");

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
      // Build minimal message structure for reply agent
      const result = await replyAgent({
        objective: message,
        message: {
          id: crypto.randomUUID(),
          userId: x402Settlement.payer || "x402-user",
          timestamp: new Date().toISOString(),
          content: message,
        },
        conversationHistory: context.map((c, i) => ({
          id: `ctx-${i}`,
          userId: c.role === "user" ? (x402Settlement.payer || "x402-user") : "assistant",
          timestamp: new Date().toISOString(),
          content: c.content,
          role: c.role,
        })),
        systemPrompt,
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
  .get("/planning", ({ request }) => generate402Response(request, "planning"))
  .post("/planning", async ({ body, request, set }) => {
    const x402Settlement = (request as any).x402Settlement;
    if (!x402Settlement) return generate402Response(request, "planning");

    const { objective, existingPlan } = body as {
      objective: string;
      existingPlan?: any;
    };

    if (!objective) {
      set.status = 400;
      return { error: "objective is required" };
    }

    try {
      const result = await planningAgent({
        objective,
        message: {
          id: crypto.randomUUID(),
          userId: x402Settlement.payer || "x402-user",
          timestamp: new Date().toISOString(),
          content: objective,
        },
        existingPlan,
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
  .get("/hypothesis", ({ request }) => generate402Response(request, "hypothesis"))
  .post("/hypothesis", async ({ body, request, set }) => {
    const x402Settlement = (request as any).x402Settlement;
    if (!x402Settlement) return generate402Response(request, "hypothesis");

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
        conversationState: {
          id: crypto.randomUUID(),
          userId: x402Settlement.payer || "x402-user",
          values: {
            currentHypothesis,
            discoveries: [],
          },
        } as any,
        completedTasks: completedTasks.map((t) => ({
          ...t,
          status: "completed" as const,
        })) as any,
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
  .get("/analysis", ({ request }) => generate402Response(request, "analysis"))
  .post("/analysis", async ({ body, request, set }) => {
    const x402Settlement = (request as any).x402Settlement;
    if (!x402Settlement) return generate402Response(request, "analysis");

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
  .get("/reflection", ({ request }) => generate402Response(request, "reflection"))
  .post("/reflection", async ({ body, request, set }) => {
    const x402Settlement = (request as any).x402Settlement;
    if (!x402Settlement) return generate402Response(request, "reflection");

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
      const result = await reflectionAgent({
        objective,
        message: {
          id: crypto.randomUUID(),
          userId: x402Settlement.payer || "x402-user",
          timestamp: new Date().toISOString(),
          content: objective,
        },
        conversationState: {
          id: crypto.randomUUID(),
          userId: x402Settlement.payer || "x402-user",
          values: {
            currentHypothesis: hypothesis,
            discoveries: discoveries as any,
          },
        } as any,
        completedTasks: completedTasks.map((t, i) => ({
          id: `task-${i}`,
          ...t,
          status: "completed" as const,
        })) as any,
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
  .get("/discovery", ({ request }) => generate402Response(request, "discovery"))
  .post("/discovery", async ({ body, request, set }) => {
    const x402Settlement = (request as any).x402Settlement;
    if (!x402Settlement) return generate402Response(request, "discovery");

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
        conversationState: {
          id: crypto.randomUUID(),
          userId: x402Settlement.payer || "x402-user",
          values: {
            discoveries: existingDiscoveries as any,
          },
        } as any,
        tasksToConsider: completedTasks.map((t) => ({
          ...t,
          status: "completed" as const,
        })) as any,
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
