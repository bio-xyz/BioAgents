import { createMessage, updateMessage } from "../../db/operations";
import { getTool } from "../../tools";
import type { State } from "../../types/core";
import logger from "../../utils/logger";
import { calculateRequestPrice } from "../../x402/pricing";

export type ToolResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export interface ToolExecutionContext {
  state: State;
  conversationState: State;
  message: any;
  files?: File[];
}

export interface MessageCreationParams {
  conversationId: string;
  userId: string;
  message: string;
  source: string;
  stateId: string;
  files: File[];
  isExternal: boolean;
}

/**
 * Create message record (for both internal and external agents)
 * External agents need persistent messages to enable multi-turn conversations
 */
export async function createMessageRecord(
  params: MessageCreationParams,
): Promise<{ success: boolean; message?: any; error?: string }> {
  const {
    conversationId,
    userId,
    message,
    source,
    stateId,
    files,
    isExternal,
  } = params;

  try {
    const fileMetadata =
      files.length > 0
        ? files.map((f: any) => ({
            name: f.name,
            size: f.size,
            type: f.type,
          }))
        : undefined;

    const createdMessage = await createMessage({
      conversation_id: conversationId,
      user_id: userId,
      question: message,
      content: "",
      source,
      state_id: stateId,
      files: fileMetadata,
    });

    if (logger) {
      logger.info(
        { messageId: createdMessage.id, isExternal },
        "message_created",
      );
    }

    return { success: true, message: createdMessage };
  } catch (err) {
    if (logger) logger.error({ err, isExternal }, "create_message_failed");
    return { success: false, error: "Failed to create message" };
  }
}

/**
 * Execute file upload tool
 */
export async function executeFileUpload(
  context: ToolExecutionContext,
): Promise<{ success: boolean; error?: string }> {
  const { state, conversationState, message, files } = context;

  if (!files || files.length === 0) {
    return { success: true };
  }

  const fileUploadTool = getTool("FILE-UPLOAD");
  if (!fileUploadTool) {
    return { success: true }; // Not a critical failure
  }

  try {
    if (logger) {
      logger.info(
        `Processing ${files.length} uploaded file(s) before planning`,
      );
    }
    await fileUploadTool.execute({
      state,
      conversationState,
      message,
      files,
    });
    return { success: true };
  } catch (err) {
    if (logger) logger.error({ err }, "file_upload_failed");
    return { success: false, error: "Failed to process uploaded files" };
  }
}

/**
 * Execute planning tool
 */
export async function executePlanning(context: ToolExecutionContext): Promise<{
  success: boolean;
  result?: { providers: string[]; actions: string[] };
  error?: string;
}> {
  const { state, conversationState, message } = context;

  const planningTool = getTool("PLANNING");
  if (!planningTool) {
    return { success: false, error: "Planning tool not found" };
  }

  try {
    const planningResult = await planningTool.execute({
      state,
      conversationState,
      message,
    });

    if (logger) {
      logger.info(
        {
          providers: planningResult.providers,
          action: planningResult.actions[0],
        },
        "Executing plan",
      );
    }

    return { success: true, result: planningResult };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (logger) {
      logger.error(
        { err, errorMessage, stack: err instanceof Error ? err.stack : undefined },
        "planning_tool_failed",
      );
    }
    
    // Provide more specific error messages
    if (errorMessage.includes("API_KEY") || errorMessage.includes("not configured")) {
      return {
        success: false,
        error: `Planning tool configuration error: ${errorMessage}`,
      };
    }
    
    if (errorMessage.includes("parse") || errorMessage.includes("XML")) {
      return {
        success: false,
        error: `Planning tool response parsing failed: ${errorMessage}`,
      };
    }
    
    return {
      success: false,
      error: `Planning tool execution failed: ${errorMessage}`,
    };
  }
}

/**
 * Execute provider tools in parallel
 */
export async function executeProviderTools(
  providers: string[],
  context: ToolExecutionContext,
): Promise<void> {
  const { state, conversationState, message } = context;

  await Promise.all(
    (providers ?? []).map(async (provider) => {
      // Skip FILE-UPLOAD since we already processed it
      if (provider === "FILE-UPLOAD") {
        return { provider, result: { ok: true, data: {} } };
      }

      const tool = getTool(provider);
      if (!tool) {
        if (logger) logger.warn({ provider }, "provider_tool_missing");
        const res: ToolResult = {
          ok: false,
          error: `Tool not found for provider: ${provider}`,
        };
        return { provider, result: res };
      }

      try {
        // Initialize estimatedCostsUSD object if not exists
        if (!state.values.estimatedCostsUSD) {
          state.values.estimatedCostsUSD = {};
        }

        // Track cost for this provider before execution
        const providerCost = calculateRequestPrice([provider]);
        state.values.estimatedCostsUSD[provider] = parseFloat(providerCost);

        const data = await tool.execute({
          state,
          conversationState,
          message,
        });
        const res: ToolResult = { ok: true, data };
        return { provider, result: res };
      } catch (err) {
        if (logger) logger.error({ provider, err }, "provider_tool_failed");
        const res: ToolResult = {
          ok: false,
          error: `Tool execution failed for provider: ${provider}`,
        };
        return { provider, result: res };
      }
    }),
  );
}

/**
 * Execute primary action tool (REPLY or HYPOTHESIS)
 */
export async function executeActionTool(
  action: string,
  context: ToolExecutionContext,
): Promise<{ success: boolean; result?: any; error?: string }> {
  const { state, conversationState, message } = context;

  const actionTool = getTool(action);
  if (!actionTool) {
    return { success: false, error: `Action tool not found: ${action}` };
  }

  // Track cost for action tool
  if (!state.values.estimatedCostsUSD) {
    state.values.estimatedCostsUSD = {};
  }
  const actionCost = calculateRequestPrice([action]);
  state.values.estimatedCostsUSD[action] = parseFloat(actionCost);

  try {
    const result = await actionTool.execute({
      state,
      conversationState,
      message,
    });
    return { success: true, result };
  } catch (err) {
    if (logger) logger.error({ action, err }, "action_tool_failed");
    return { success: false, error: `Action tool execution failed: ${action}` };
  }
}

/**
 * Execute reflection tool (optional)
 */
export async function executeReflection(
  context: ToolExecutionContext,
): Promise<void> {
  const { state, conversationState, message } = context;

  const reflectionTool = getTool("REFLECTION");
  if (!reflectionTool) {
    if (logger) logger.warn("REFLECTION tool not found");
    return;
  }

  try {
    // Track cost for REFLECTION tool
    if (!state.values.estimatedCostsUSD) {
      state.values.estimatedCostsUSD = {};
    }
    const reflectionCost = calculateRequestPrice(["REFLECTION"]);
    state.values.estimatedCostsUSD["REFLECTION"] = parseFloat(reflectionCost);

    await reflectionTool.execute({
      state,
      conversationState,
      message,
    });
    if (logger) logger.info("REFLECTION executed successfully");
  } catch (err) {
    if (logger) logger.error({ err }, "reflection_tool_failed");
    // Don't fail the request if REFLECTION fails
  }
}

/**
 * Update message response time
 */
export async function updateMessageResponseTime(
  messageId: string,
  responseTime: number,
  isExternal: boolean,
): Promise<void> {
  if (isExternal) {
    return; // Skip for external agents
  }

  try {
    await updateMessage(messageId, {
      response_time: responseTime,
    });
  } catch (err) {
    if (logger) logger.error({ err }, "failed_to_update_response_time");
  }
}
