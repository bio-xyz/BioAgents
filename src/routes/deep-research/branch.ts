import { Elysia } from "elysia";
import { getServiceClient } from "../../db/client";
import { authResolver } from "../../middleware/authResolver";
import type { ElysiaRouteContext } from "../../types/elysia";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";

type BranchBody = {
  conversationId?: string;
  title?: string;
  objective?: string;
};

const COPY_MESSAGE_COLUMNS = [
  "question",
  "content",
  "source",
  "files",
  "summary",
  "clean_content",
  "citation_metadata",
  "response_time",
  "created_at",
] as const;

const DEEP_RESEARCH_PREFIX = "[Deep Research]";

const COPY_STATE_KEYS = [
  "objective",
  "discoveries",
  "plan",
  "keyInsights",
  "methodology",
  "hypothesis",
  "currentHypothesis",
  "datasets",
  "uploadedDatasets",
  "clarificationContext",
  "researchMode",
] as const;

function toStateValues(rawValues: unknown): Record<string, unknown> {
  if (!rawValues) return {};
  if (typeof rawValues === "string") {
    try {
      return JSON.parse(rawValues);
    } catch {
      return {};
    }
  }
  if (typeof rawValues === "object") {
    return rawValues as Record<string, unknown>;
  }
  return {};
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.startsWith(DEEP_RESEARCH_PREFIX)) {
    return trimmed;
  }
  return `${DEEP_RESEARCH_PREFIX} ${trimmed}`;
}

function normalizeObjective(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export const deepResearchBranchRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true,
      }),
    ],
  },
  (app) => app.post("/api/deep-research/branch", deepResearchBranchHandler)
);

function parseBranchBody(body: unknown): BranchBody {
  if (typeof body !== "object" || body === null) return {};
  const record = body as Record<string, unknown>;
  const pickString = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    conversationId: pickString(record.conversationId),
    objective: pickString(record.objective),
    title: pickString(record.title),
  };
}

async function deepResearchBranchHandler(ctx: ElysiaRouteContext) {
  const { body, set, request } = ctx;
  const parsedBody = parseBranchBody(body);
  const auth = request.auth;
  const userId = auth?.userId;

  if (!userId) {
    set.status = 401;
    return {
      error: "Authentication required",
      ok: false,
    };
  }

  const sourceConversationId = parsedBody.conversationId?.trim();
  const title = parsedBody.title?.trim();
  const objectiveOverride = parsedBody.objective?.trim();

  if (!sourceConversationId) {
    set.status = 400;
    return {
      error: "Missing required field: conversationId",
      ok: false,
    };
  }

  if (!title) {
    set.status = 400;
    return {
      error: "Missing required field: title",
      ok: false,
    };
  }

  const supabase = getServiceClient();

  try {
    const { data: sourceConversation, error: sourceConversationError } = await supabase
      .from("conversations")
      .select("id, user_id, conversation_state_id")
      .eq("id", sourceConversationId)
      .single();

    if (sourceConversationError || !sourceConversation) {
      set.status = 404;
      return {
        error: "Source conversation not found",
        ok: false,
      };
    }

    if (sourceConversation.user_id !== userId) {
      set.status = 403;
      return {
        error: "Access denied: conversation belongs to another user",
        ok: false,
      };
    }

    if (!sourceConversation.conversation_state_id) {
      set.status = 400;
      return {
        error: "Source conversation has no deep research state",
        ok: false,
      };
    }

    const { data: sourceConversationState, error: sourceStateError } = await supabase
      .from("conversation_states")
      .select("id, values")
      .eq("id", sourceConversation.conversation_state_id)
      .single();

    if (sourceStateError || !sourceConversationState) {
      set.status = 404;
      return {
        error: "Source conversation state not found",
        ok: false,
      };
    }

    const sourceValues = toStateValues(sourceConversationState.values);
    const sourceObjective = normalizeObjective(sourceValues.objective);
    const branchedValues: Record<string, unknown> = {};

    COPY_STATE_KEYS.forEach((key) => {
      if (sourceValues[key] !== undefined) {
        branchedValues[key] = sourceValues[key];
      }
    });

    const finalObjective =
      objectiveOverride || sourceObjective || normalizeObjective(branchedValues.objective);
    branchedValues.objective = finalObjective;
    branchedValues.conversationTitle = title;
    branchedValues.suggestedNextSteps = [];

    const { data: newConversationState, error: newStateError } = await supabase
      .from("conversation_states")
      .insert({
        values: branchedValues,
      })
      .select("id")
      .single();

    if (newStateError || !newConversationState) {
      logger.error(
        {
          err: newStateError,
          sourceConversationId,
          userId,
        },
        "deep_research_branch_create_state_failed"
      );
      set.status = 500;
      return {
        error: "Failed to create branched conversation state",
        ok: false,
      };
    }

    const branchedConversationId = generateUUID();

    const { error: createConversationError } = await supabase.from("conversations").insert({
      conversation_state_id: newConversationState.id,
      id: branchedConversationId,
      parent_conversation_id: sourceConversationId,
      title: normalizeTitle(title),
      user_id: userId,
    });

    if (createConversationError) {
      logger.error(
        {
          branchedConversationId,
          err: createConversationError,
          sourceConversationId,
          userId,
        },
        "deep_research_branch_create_conversation_failed"
      );
      set.status = 500;
      return {
        error: "Failed to create branched conversation",
        ok: false,
      };
    }

    const { data: sourceMessages, error: sourceMessagesError } = await supabase
      .from("messages")
      .select(COPY_MESSAGE_COLUMNS.join(", "))
      .eq("conversation_id", sourceConversationId)
      .order("created_at", { ascending: true });

    if (sourceMessagesError) {
      logger.error(
        {
          branchedConversationId,
          err: sourceMessagesError,
          sourceConversationId,
          userId,
        },
        "deep_research_branch_fetch_messages_failed"
      );
      const { error: deleteConvError } = await supabase
        .from("conversations")
        .delete()
        .eq("id", branchedConversationId);
      const { error: deleteStateError } = await supabase
        .from("conversation_states")
        .delete()
        .eq("id", newConversationState.id);
      if (deleteConvError || deleteStateError) {
        logger.error(
          { branchedConversationId, deleteConvError, deleteStateError },
          "deep_research_branch_rollback_failed"
        );
      }
      set.status = 500;
      return {
        error: "Failed to copy source messages",
        ok: false,
      };
    }

    if (sourceMessages && sourceMessages.length > 0) {
      const copiedMessages = (sourceMessages as unknown as Record<string, unknown>[]).map(
        (row) => ({
          ...row,
          conversation_id: branchedConversationId,
          source: row.source ?? "ui",
          state_id: null,
          user_id: userId,
        })
      );

      const { error: copyMessagesError } = await supabase.from("messages").insert(copiedMessages);

      if (copyMessagesError) {
        logger.error(
          {
            branchedConversationId,
            err: copyMessagesError,
            sourceConversationId,
            userId,
          },
          "deep_research_branch_copy_messages_failed"
        );
        const { error: deleteConvError } = await supabase
          .from("conversations")
          .delete()
          .eq("id", branchedConversationId);
        const { error: deleteStateError } = await supabase
          .from("conversation_states")
          .delete()
          .eq("id", newConversationState.id);
        if (deleteConvError || deleteStateError) {
          logger.error(
            { branchedConversationId, deleteConvError, deleteStateError },
            "deep_research_branch_rollback_failed"
          );
        }
        set.status = 500;
        return {
          error: "Failed to copy messages into branched conversation",
          ok: false,
        };
      }
    }

    logger.info(
      {
        branchedConversationId,
        sourceConversationId,
        userId,
      },
      "deep_research_branch_created"
    );

    set.status = 201;
    return {
      conversationId: branchedConversationId,
      ok: true,
    };
  } catch (error) {
    logger.error(
      {
        err: error,
        sourceConversationId,
        userId,
      },
      "deep_research_branch_failed"
    );
    set.status = 500;
    return {
      error: "Failed to branch deep research conversation",
      ok: false,
    };
  }
}
