import { Elysia } from "elysia";
import { getServiceClient } from "../../db/client";
import { authResolver } from "../../middleware/authResolver";
import type { AuthContext } from "../../types/auth";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";

type BranchBody = {
  conversationId?: string;
  title?: string;
  objective?: string;
};

type DbMessageRow = {
  question: string | null;
  content: string;
  source: string | null;
  files: unknown;
  summary: string | null;
  clean_content: string | null;
  citation_metadata: unknown;
  response_time: number | null;
  created_at: string;
};

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
  (app) => app.post("/api/deep-research/branch", deepResearchBranchHandler),
);

async function deepResearchBranchHandler(ctx: any) {
  const { body, set, request } = ctx;
  const parsedBody = body as BranchBody;
  const auth = (request as any).auth as AuthContext | undefined;
  const userId = auth?.userId;

  if (!userId) {
    set.status = 401;
    return {
      ok: false,
      error: "Authentication required",
    };
  }

  const sourceConversationId = parsedBody.conversationId?.trim();
  const title = parsedBody.title?.trim();
  const objectiveOverride = parsedBody.objective?.trim();

  if (!sourceConversationId) {
    set.status = 400;
    return {
      ok: false,
      error: "Missing required field: conversationId",
    };
  }

  if (!title) {
    set.status = 400;
    return {
      ok: false,
      error: "Missing required field: title",
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
        ok: false,
        error: "Source conversation not found",
      };
    }

    if (sourceConversation.user_id !== userId) {
      set.status = 403;
      return {
        ok: false,
        error: "Access denied: conversation belongs to another user",
      };
    }

    if (!sourceConversation.conversation_state_id) {
      set.status = 400;
      return {
        ok: false,
        error: "Source conversation has no deep research state",
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
        ok: false,
        error: "Source conversation state not found",
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
      objectiveOverride ||
      sourceObjective ||
      normalizeObjective(branchedValues.objective);
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
          userId,
          sourceConversationId,
        },
        "deep_research_branch_create_state_failed",
      );
      set.status = 500;
      return {
        ok: false,
        error: "Failed to create branched conversation state",
      };
    }

    const branchedConversationId = generateUUID();

    const { error: createConversationError } = await supabase
      .from("conversations")
      .insert({
        id: branchedConversationId,
        user_id: userId,
        title: normalizeTitle(title),
        conversation_state_id: newConversationState.id,
        parent_conversation_id: sourceConversationId,
      });

    if (createConversationError) {
      logger.error(
        {
          err: createConversationError,
          userId,
          sourceConversationId,
          branchedConversationId,
        },
        "deep_research_branch_create_conversation_failed",
      );
      set.status = 500;
      return {
        ok: false,
        error: "Failed to create branched conversation",
      };
    }

    const { data: sourceMessages, error: sourceMessagesError } = await supabase
      .from("messages")
      .select(
        "question, content, source, files, summary, clean_content, citation_metadata, response_time, created_at",
      )
      .eq("conversation_id", sourceConversationId)
      .order("created_at", { ascending: true });

    if (sourceMessagesError) {
      logger.error(
        {
          err: sourceMessagesError,
          userId,
          sourceConversationId,
          branchedConversationId,
        },
        "deep_research_branch_fetch_messages_failed",
      );
      const { error: deleteConvError } = await supabase.from("conversations").delete().eq("id", branchedConversationId);
      const { error: deleteStateError } = await supabase.from("conversation_states").delete().eq("id", newConversationState.id);
      if (deleteConvError || deleteStateError) {
        logger.error({ deleteConvError, deleteStateError, branchedConversationId }, "deep_research_branch_rollback_failed");
      }
      set.status = 500;
      return {
        ok: false,
        error: "Failed to copy source messages",
      };
    }

    if (sourceMessages && sourceMessages.length > 0) {
      const copiedMessages = (sourceMessages as DbMessageRow[]).map((message) => ({
        conversation_id: branchedConversationId,
        user_id: userId,
        question: message.question,
        content: message.content,
        source: message.source ?? "ui",
        files: message.files ?? null,
        summary: message.summary ?? null,
        clean_content: message.clean_content ?? null,
        citation_metadata: message.citation_metadata ?? null,
        response_time: message.response_time ?? null,
        state_id: null,
        created_at: message.created_at,
      }));

      const { error: copyMessagesError } = await supabase
        .from("messages")
        .insert(copiedMessages);

      if (copyMessagesError) {
        logger.error(
          {
            err: copyMessagesError,
            userId,
            sourceConversationId,
            branchedConversationId,
          },
          "deep_research_branch_copy_messages_failed",
        );
        const { error: deleteConvError } = await supabase.from("conversations").delete().eq("id", branchedConversationId);
        const { error: deleteStateError } = await supabase.from("conversation_states").delete().eq("id", newConversationState.id);
        if (deleteConvError || deleteStateError) {
          logger.error({ deleteConvError, deleteStateError, branchedConversationId }, "deep_research_branch_rollback_failed");
        }
        set.status = 500;
        return {
          ok: false,
          error: "Failed to copy messages into branched conversation",
        };
      }
    }

    logger.info(
      {
        userId,
        sourceConversationId,
        branchedConversationId,
      },
      "deep_research_branch_created",
    );

    set.status = 201;
    return {
      ok: true,
      conversationId: branchedConversationId,
    };
  } catch (error) {
    logger.error(
      {
        err: error,
        userId,
        sourceConversationId,
      },
      "deep_research_branch_failed",
    );
    set.status = 500;
    return {
      ok: false,
      error: "Failed to branch deep research conversation",
    };
  }
}
