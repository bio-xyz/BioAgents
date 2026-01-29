// API routes for the autonomous demo

import { Elysia, t } from "elysia";
import {
  getActiveSessionsFromMemory,
  getSessionFromMemory,
  restart,
} from "../services/orchestrator";
import {
  getSession,
  getArchivedSessions,
  getSessionMessages,
  updateSession,
} from "../db/operations";
import { mainServerClient } from "../services/main-server-client";
import logger from "../utils/logger";

export const apiRoutes = new Elysia({ prefix: "/api" })
  // Health check
  .get("/health", () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))

  // Get all active sessions
  .get("/sessions", () => {
    const sessions = getActiveSessionsFromMemory();
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        conversationId: s.conversationId,
        topic: s.topic,
        status: s.status,
        currentIteration: s.currentIteration,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  })

  // Get single session with messages
  .get("/sessions/:id", async ({ params }) => {
    const session = getSessionFromMemory(params.id);
    if (!session) {
      const dbSession = await getSession(params.id);
      if (!dbSession) {
        return { error: "Session not found" };
      }
      const messages = await getSessionMessages(params.id);
      return {
        session: {
          ...dbSession,
          createdAt: dbSession.createdAt.toISOString(),
          updatedAt: dbSession.updatedAt.toISOString(),
          archivedAt: dbSession.archivedAt?.toISOString(),
        },
        messages: messages.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }

    const messages = await getSessionMessages(params.id);

    // Also try to get latest conversation state from main server
    let conversationState = null;
    try {
      const stateResponse = await mainServerClient.getConversationState(session.conversationId);
      conversationState = stateResponse?.values || null;
    } catch (error) {
      logger.warn({ error }, "Failed to fetch conversation state");
    }

    return {
      session: {
        ...session,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      },
      messages: messages.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
      conversationState,
    };
  })

  // Get conversation state for a session
  .get("/sessions/:id/state", async ({ params }) => {
    const session = getSessionFromMemory(params.id) || (await getSession(params.id));
    if (!session) {
      return { error: "Session not found" };
    }

    try {
      const stateResponse = await mainServerClient.getConversationState(session.conversationId);
      return {
        state: stateResponse?.values || null,
      };
    } catch (error) {
      logger.error({ error }, "Failed to fetch state");
      return { error: "Failed to fetch state" };
    }
  })

  // Force archive a session
  .post("/sessions/:id/archive", async ({ params }) => {
    const session = getSessionFromMemory(params.id);
    if (!session) {
      return { error: "Session not found or not active" };
    }

    try {
      // Get final state
      const stateResponse = await mainServerClient.getConversationState(session.conversationId);

      // Try to generate paper
      let paperId: string | undefined;
      let paperUrl: string | undefined;
      try {
        const paperResult = await mainServerClient.generatePaper(session.conversationId);
        if (paperResult.success) {
          paperId = paperResult.paperId;
          paperUrl = paperResult.pdfUrl;
        }
      } catch (error) {
        logger.warn({ error }, "Paper generation failed during force archive");
      }

      await updateSession(params.id, {
        status: "archived",
        finalState: stateResponse?.values,
        paperId,
        paperUrl,
        archivedAt: new Date(),
      });

      return { success: true };
    } catch (error) {
      logger.error({ error }, "Failed to archive session");
      return { error: "Failed to archive session" };
    }
  })

  // Get archived sessions
  .get("/archive", async () => {
    const archived = await getArchivedSessions();
    return {
      sessions: archived.map((s) => ({
        id: s.id,
        conversationId: s.conversationId,
        topic: s.topic,
        status: s.status,
        currentIteration: s.currentIteration,
        paperId: s.paperId,
        paperUrl: s.paperUrl,
        createdAt: s.createdAt.toISOString(),
        archivedAt: s.archivedAt?.toISOString(),
      })),
    };
  })

  // Get single archived session
  .get("/archive/:id", async ({ params }) => {
    const session = await getSession(params.id);
    if (!session || session.status !== "archived") {
      return { error: "Archived session not found" };
    }

    const messages = await getSessionMessages(params.id);

    // Get fresh paper URL if available
    let paperUrl = session.paperUrl;
    if (session.paperId) {
      try {
        const paper = await mainServerClient.getPaper(session.paperId);
        paperUrl = paper.pdfUrl;
      } catch (error) {
        logger.warn({ error }, "Failed to get fresh paper URL");
      }
    }

    return {
      session: {
        ...session,
        paperUrl,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        archivedAt: session.archivedAt?.toISOString(),
      },
      messages: messages.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  })

  // Restart with fresh topics
  .post("/restart", async () => {
    logger.info("Restart requested via API");
    await restart();
    return { success: true, message: "Orchestrator restarted with fresh topics" };
  });
