import { Elysia } from "elysia";
import { updateMessage } from "../../db/operations";
import { LLM } from "../../llm/provider";
import { recordPayment } from "../../services/chat/payment";
import {
  ensureUserAndConversation,
  setupConversationData,
  X402_SYSTEM_USER_ID,
} from "../../services/chat/setup";
import {
  createMessageRecord,
  executeFileUpload,
  updateMessageResponseTime,
} from "../../services/chat/tools";
import type { State } from "../../types/core";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";
import { getTool } from "../../tools";

type DeepResearchStartResponse = {
  messageId: string | null;
  conversationId: string;
  status: "processing" | "rejected";
  error?: string;
};

const VALIDATION_PROMPT = `You are a strict validator for deep research requests. A well-formatted deep research request MUST include ALL of the following sections:

1. **Goals** - What the research aims to achieve
2. **Requirements** - Specific criteria or constraints
3. **Datasets** - Data sources to use (or explicitly state "No datasets" if none)
4. **Prior Works** - Existing research or papers to reference (or explicitly state "No prior works" if none)
5. **Experiment Ideas** - Proposed experiments or methodologies to test (or explicitly state "No experiment ideas" if none)
6. **Desired Outputs** - Expected format and content of results

Analyze the following user message and determine if it contains ALL six sections with meaningful content.

IMPORTANT:
- If a section explicitly says "No datasets", "No prior works", or "No experiment ideas", that counts as valid
- Each section should have at least one sentence of meaningful content
- The sections don't need specific headers, but the content must be clearly present

Respond with ONLY "YES" if the message is properly formatted, or "NO" if it's missing any required sections.

User message:
{{message}}

Response (YES or NO):`;

const REJECTION_MESSAGE = `Deep research request rejected. Your message must include ALL of the following sections:

**Required Format:**

1. **Goals**: What you want to achieve with this research
   Example: "Identify the most promising senolytic compounds for human trials"

2. **Requirements**: Specific criteria or constraints
   Example: "Focus on compounds tested in mammalian models, published in last 5 years"

3. **Datasets**: Data sources to analyze
   Example: "Uploaded files or datasets from your knowledge base" OR "No datasets" if none needed

4. **Prior Works**: Existing research to reference
   Example: "Build on Unity Biotechnology's senolytic trials" OR "No prior works" if starting fresh

5. **Experiment Ideas**: Proposed experiments or methodologies to validate findings
   Example: "Test top 3 compounds in aged mouse models, measure p16 expression" OR "No experiment ideas" if none

6. **Desired Outputs**: What format you want the results in
   Example: "Comprehensive report with ranked compounds, mechanisms, and trial readiness assessment"

**Tip**: If you don't need a particular section, explicitly write "No datasets", "No prior works", or "No experiment ideas" instead of omitting it.

Please reformat your message to include all sections and try again.`;

/**
 * Validate deep research message format using LLM
 */
async function validateDeepResearchMessage(message: string): Promise<boolean> {
  const VALIDATION_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "google";
  const validationApiKey =
    process.env[`${VALIDATION_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!validationApiKey) {
    logger.warn("Validation API key not configured, skipping validation");
    return true; // Skip validation if not configured
  }

  const llmProvider = new LLM({
    // @ts-ignore
    name: VALIDATION_LLM_PROVIDER,
    apiKey: validationApiKey,
  });

  const validationPrompt = VALIDATION_PROMPT.replace("{{message}}", message);

  try {
    const response = await llmProvider.createChatCompletion({
      model: process.env.PLANNING_LLM_MODEL || "gemini-2.0-flash-exp",
      messages: [
        {
          role: "user",
          content: validationPrompt,
        },
      ],
      temperature: 0,
      maxTokens: 10,
    });

    const answer = response.content.trim().toUpperCase();
    const isValid = answer === "YES";

    if (logger) {
      logger.info(
        { isValid, answer, messagePreview: message.slice(0, 100) },
        "x402_research_validation_result",
      );
    }

    return isValid;
  } catch (error) {
    if (logger) {
      logger.error({ err: error }, "x402_research_validation_failed");
    }
    // If validation fails, allow the request to proceed
    return true;
  }
}

/**
 * Run deep research in background
 */
async function runDeepResearch(params: {
  stateRecord: any;
  conversationStateRecord: any;
  createdMessage: any;
  files: File[];
  setupResult: any;
  x402ExternalRecord?: any;
  paymentSettlement?: any;
  paymentHeader?: any;
  paymentRequirement?: any;
}): Promise<void> {
  const {
    stateRecord,
    conversationStateRecord,
    createdMessage,
    files,
    setupResult,
    x402ExternalRecord,
    paymentSettlement,
    paymentHeader,
    paymentRequirement,
  } = params;

  const startTime = Date.now();

  try {
    const state: State = {
      id: stateRecord.id,
      values: stateRecord.values,
    };
    const conversationState: State = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    const context = {
      state,
      conversationState,
      message: createdMessage,
      files,
    };

    // Process files if any
    if (files.length > 0) {
      await executeFileUpload(context);
    }

    // Execute deep research planning
    const deepResearchTool = getTool("PLANNING_DEEP_RESEARCH");
    if (!deepResearchTool) {
      throw new Error("PLANNING_DEEP_RESEARCH tool not found");
    }

    const result = await deepResearchTool.execute({
      state,
      conversationState,
      message: createdMessage,
    });

    const finalResponse = result.text || "Research completed";

    // Update message with final response
    await updateMessage(createdMessage.id, {
      content: finalResponse,
    });

    // Update response time
    await updateMessageResponseTime(
      createdMessage.id,
      Date.now() - startTime,
      setupResult.isExternal ?? false,
    );

    // Record payment if settlement occurred
    if (paymentSettlement?.success && paymentRequirement) {
      await recordPayment({
        isExternal: setupResult.isExternal || false,
        conversationId: createdMessage.conversation_id,
        messageId: createdMessage.id,
        userId: createdMessage.user_id,
        paymentSettlement,
        paymentRequirement,
        paymentHeader,
        x402ExternalRecord,
        providers: [], // Planning tool handles all providers internally
        responseTime: Date.now() - startTime,
      });
    }

    if (logger) {
      logger.info(
        {
          messageId: createdMessage.id,
          responseTime: Date.now() - startTime,
        },
        "x402_research_completed",
      );
    }
  } catch (error) {
    if (logger) {
      logger.error({ err: error, messageId: createdMessage.id }, "x402_research_failed");
    }

    // Update state with error
    await updateMessage(createdMessage.id, {
      content: `Research failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

/**
 * x402 Deep Research Route Plugin
 *
 * Dedicated endpoint for x402 deep research requests
 * - No authentication required (payment only)
 * - Uses x402_agent source
 * - Returns immediately with messageId, processes in background
 * - x402 payment enforced by global middleware in src/index.ts
 */
export const x402ResearchRoute = new Elysia()
  // GET endpoint for x402scan discovery
  .get("/api/x402/research", async () => {
    const responseData = {
      message: "x402 Deep Research API - requires POST with X-PAYMENT header",
      documentation: "https://docs.x402.org",
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "identity",
      },
    });
  })
  // POST endpoint for actual deep research
  .post(
  "/api/x402/research",
  async (ctx) => {
    const {
      body,
      set,
      request,
      paymentSettlement,
      paymentRequirement,
      paymentHeader,
    } = ctx as any;

    try {
      const parsedBody = body as any;

      if (logger) {
        logger.info({
          hasPaymentHeader: !!paymentHeader,
          hasPaymentSettlement: !!paymentSettlement,
          paymentSettlementSuccess: paymentSettlement?.success,
          source: "x402_research",
        }, "x402_research_route_entry");
      }

      // Extract message (REQUIRED)
      const message = parsedBody.message;
      if (!message) {
        if (logger) {
          logger.warn({ bodyKeys: Object.keys(parsedBody) }, "x402_research_missing_message");
        }
        set.status = 400;
        return { error: "Missing required field: message" };
      }

      // Validate message format
      const isValid = await validateDeepResearchMessage(message);
      if (!isValid) {
        if (logger) {
          logger.warn({ messagePreview: message.slice(0, 100) }, "x402_research_validation_failed");
        }
        set.status = 400;
        const response: DeepResearchStartResponse = {
          messageId: null,
          conversationId: "",
          status: "rejected",
          error: REJECTION_MESSAGE,
        };
        return response;
      }

      // Extract optional fields
      const conversationId = parsedBody.conversationId || generateUUID();
      const userId = parsedBody.userId || generateUUID();

      if (logger) {
        logger.info(
          {
            conversationId,
            userId,
            messageLength: message.length,
            source: "x402_agent",
          },
          "x402_research_request",
        );
      }

      // Files are not supported for x402 in stage 1
      const files: File[] = [];

      // Setup user and conversation
      const setupResult = await ensureUserAndConversation(
        userId,
        conversationId,
        undefined,
        "x402_agent",
      );

      if (!setupResult.success) {
        if (logger) logger.error(setupResult, "x402_research_setup_failed");
        set.status = 500;
        return { error: setupResult.error || "Setup failed" };
      }

      const isExternal = setupResult.isExternal ?? false;

      // Setup conversation data
      const conversationDataResult = await setupConversationData(
        conversationId,
        userId,
        "x402_agent",
        isExternal,
        message,
        files.length,
        userId,
      );

      if (!conversationDataResult.success || !conversationDataResult.data) {
        if (logger) logger.error(conversationDataResult, "x402_research_conversation_data_failed");
        set.status = 500;
        return { error: conversationDataResult.error || "Failed to setup conversation data" };
      }

      const { conversationStateRecord, stateRecord, x402ExternalRecord } =
        conversationDataResult.data;

      // Create message record
      const messageResult = await createMessageRecord({
        conversationId,
        userId: isExternal ? X402_SYSTEM_USER_ID : userId,
        message,
        source: "x402_agent",
        stateId: stateRecord.id,
        files,
        isExternal,
      });

      if (!messageResult.success || !messageResult.message) {
        if (logger) logger.error(messageResult, "x402_research_create_message_failed");
        set.status = 500;
        return { error: messageResult.error || "Failed to create message" };
      }

      const createdMessage = messageResult.message;

      if (logger) {
        logger.info(
          { messageId: createdMessage.id, conversationId },
          "x402_research_message_created",
        );
      }

      // Return immediately with messageId
      const response: DeepResearchStartResponse = {
        messageId: createdMessage.id,
        conversationId,
        status: "processing",
      };

      // Run the actual research in the background (no await)
      runDeepResearch({
        stateRecord,
        conversationStateRecord,
        createdMessage,
        files,
        setupResult,
        x402ExternalRecord,
        paymentSettlement,
        paymentHeader,
        paymentRequirement,
      }).catch((err) => {
        if (logger) {
          logger.error({ err, messageId: createdMessage.id }, "x402_research_background_failed");
        }
      });

      return response;
    } catch (error: any) {
      if (logger) {
        logger.error({ err: error }, "x402_research_route_error");
      }
      set.status = 500;
      return {
        error: "Internal server error",
        message: error?.message || "Unknown error",
      };
    }
  },
);
