// Main orchestrator service - coordinates autonomous research using Claude Opus

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../utils/config";
import logger from "../../utils/logger";
import {
  TOPIC_GENERATOR_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
  buildEvaluationPrompt,
} from "./prompts";
import type {
  ResearchTopic,
  TopicGeneratorResponse,
  OrchestratorEvaluation,
  DemoSession,
  ConversationStateValues,
} from "./types";
import { mainServerClient } from "../main-server-client";
import {
  createSession,
  updateSession,
  createMessage,
  getActiveSessions,
  deleteAllActiveSessions,
} from "../../db/operations";

// Global state for tracking active sessions
let activeSessions: Map<string, DemoSession> = new Map();
let orchestratorRunning = false;

// Anthropic client
let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }
  return anthropic;
}

/**
 * Generate 3 longevity research topics using Opus
 */
export async function generateTopics(): Promise<ResearchTopic[]> {
  const client = getAnthropicClient();

  logger.info("Generating research topics with Opus");

  const response = await client.messages.create({
    model: config.orchestratorModel,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: TOPIC_GENERATOR_PROMPT,
      },
    ],
  });

  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Opus");
  }

  try {
    // Strip markdown code blocks if present (```json ... ```)
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonText) as TopicGeneratorResponse;
    logger.info({ topicCount: parsed.topics.length }, "Generated topics");
    return parsed.topics;
  } catch (error) {
    logger.error({ error, response: textContent.text }, "Failed to parse topic response");
    throw new Error("Failed to parse topic response from Opus");
  }
}

/**
 * Evaluate research progress and decide next action
 */
export async function evaluateResearch(
  topic: ResearchTopic,
  iteration: number,
  conversationState: ConversationStateValues,
  lastResponse: string
): Promise<OrchestratorEvaluation> {
  const client = getAnthropicClient();

  const evaluationPrompt = buildEvaluationPrompt(
    topic,
    iteration,
    conversationState,
    lastResponse
  );

  logger.info({ topic: topic.title, iteration }, "Evaluating research progress");

  const response = await client.messages.create({
    model: config.orchestratorModel,
    max_tokens: 1500,
    system: ORCHESTRATOR_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: evaluationPrompt,
      },
    ],
  });

  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Opus");
  }

  try {
    // Strip markdown code blocks if present (```json ... ```)
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const evaluation = JSON.parse(jsonText) as OrchestratorEvaluation;
    logger.info(
      { topic: topic.title, decision: evaluation.decision, confidence: evaluation.confidence },
      "Evaluation complete"
    );
    return evaluation;
  } catch (error) {
    logger.error({ error, response: textContent.text }, "Failed to parse evaluation");
    // Default to continue if parsing fails - use context-aware message
    const suggestions = conversationState.suggestedNextSteps || [];
    const suggestionText = suggestions.length > 0
      ? `Consider these suggested directions: ${suggestions.map(s => s.objective).join("; ")}`
      : `Explore deeper aspects of ${topic.title}, particularly looking for mechanistic insights and novel connections in the literature.`;

    return {
      decision: "CONTINUE",
      reasoning: "Failed to parse evaluation response, defaulting to continue with context-aware guidance",
      steeringMessage: suggestionText,
      confidence: "low",
    };
  }
}

/**
 * Run a single research iteration for a session
 */
async function runIteration(session: DemoSession): Promise<void> {
  const sessionId = session.id;
  logger.info({ sessionId, iteration: session.currentIteration + 1 }, "Starting iteration");

  try {
    // Determine the message to send
    let message: string;
    if (session.currentIteration === 0) {
      // First iteration - use the research question
      message = `${session.topic.researchQuestion}\n\nBackground: ${session.topic.background}`;
    } else {
      // Subsequent iterations - use the last steering message from Opus evaluation
      const lastDecision = session.orchestratorDecisions[session.orchestratorDecisions.length - 1];
      if (!lastDecision?.steeringMessage) {
        logger.warn({ sessionId, iteration: session.currentIteration }, "No steering message from last evaluation");
      }
      message = lastDecision?.steeringMessage || `Based on the research so far on "${session.topic.title}", what additional insights can you uncover? Focus on deepening the analysis and finding novel connections.`;
    }

    // Record the orchestrator message
    await createMessage(sessionId, "orchestrator", message);

    // Start deep research on main server
    const startResponse = await mainServerClient.startDeepResearch(
      message,
      session.conversationId
    );

    logger.info(
      { sessionId, messageId: startResponse.messageId },
      "Deep research started"
    );

    // Wait for completion - polls message directly from DB
    const result = await mainServerClient.waitForCompletion(startResponse.messageId);

    // Get response text from result
    const responseText = result.result?.text || "No response";

    // Record the main server response
    await createMessage(sessionId, "main_server", responseText, startResponse.messageId);

    // Get the conversation state for evaluation
    const stateResponse = await mainServerClient.getConversationState(session.conversationId);
    const conversationState = stateResponse?.values || { objective: session.topic.researchQuestion };

    // Update iteration count
    session.currentIteration += 1;
    await updateSession(sessionId, { currentIteration: session.currentIteration });

    // Evaluate with Opus
    const evaluation = await evaluateResearch(
      session.topic,
      session.currentIteration,
      conversationState,
      responseText
    );

    // Store the decision
    session.orchestratorDecisions.push(evaluation);
    await updateSession(sessionId, { orchestratorDecisions: session.orchestratorDecisions });

    // Handle the decision
    if (evaluation.decision === "CONCLUDE") {
      await concludeSession(session, conversationState);
    } else if (session.currentIteration >= config.maxIterations) {
      logger.warn({ sessionId }, "Max iterations reached, forcing conclusion");
      await concludeSession(session, conversationState);
    }
    // For CONTINUE or REDIRECT, the next iteration will be triggered by the orchestrator loop
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error({ sessionId, error: errorMessage, stack: errorStack }, "Iteration failed");
    await updateSession(sessionId, { status: "failed" });
    activeSessions.delete(sessionId);
  }
}

/**
 * Conclude a research session and generate paper
 */
async function concludeSession(
  session: DemoSession,
  finalState: ConversationStateValues
): Promise<void> {
  const sessionId = session.id;
  logger.info({ sessionId }, "Concluding research session");

  try {
    // Mark as archiving
    await updateSession(sessionId, { status: "archiving", finalState });

    // Generate paper
    const paperResult = await mainServerClient.generatePaper(session.conversationId);

    if (paperResult.success) {
      await updateSession(sessionId, {
        status: "archived",
        paperId: paperResult.paperId,
        paperUrl: paperResult.pdfUrl,
        archivedAt: new Date(),
      });
      logger.info({ sessionId, paperId: paperResult.paperId }, "Session archived with paper");
    } else {
      await updateSession(sessionId, {
        status: "archived",
        archivedAt: new Date(),
      });
      logger.warn({ sessionId, error: paperResult.error }, "Session archived without paper");
    }

    // Remove from active sessions
    activeSessions.delete(sessionId);

    // Start a new session to replace this one
    await startNewSession();
  } catch (error) {
    logger.error({ sessionId, error }, "Failed to conclude session");
    await updateSession(sessionId, { status: "failed" });
    activeSessions.delete(sessionId);
  }
}

/**
 * Start a new research session with a generated topic
 */
async function startNewSession(): Promise<DemoSession | null> {
  try {
    // Generate a single new topic
    const topics = await generateTopics();
    const topic = topics[0];

    // Generate a unique conversation ID
    const conversationId = crypto.randomUUID();

    // Create the session in DB
    const session = await createSession(conversationId, topic);
    activeSessions.set(session.id, session);

    logger.info({ sessionId: session.id, topic: topic.title }, "New session started");

    return session;
  } catch (error) {
    logger.error({ error }, "Failed to start new session");
    return null;
  }
}

/**
 * Initialize the orchestrator with 3 research sessions
 */
export async function initialize(): Promise<void> {
  logger.info("Initializing orchestrator");

  // Load any existing active sessions from DB
  const existingSessions = await getActiveSessions();
  for (const session of existingSessions) {
    activeSessions.set(session.id, session);
  }

  // If we have fewer than 3 active sessions, generate more
  const sessionsNeeded = 3 - activeSessions.size;
  if (sessionsNeeded > 0) {
    logger.info({ sessionsNeeded }, "Generating new research topics");

    try {
      const topics = await generateTopics();

      for (let i = 0; i < Math.min(sessionsNeeded, topics.length); i++) {
        const conversationId = crypto.randomUUID();
        const session = await createSession(conversationId, topics[i]);
        activeSessions.set(session.id, session);
        logger.info({ sessionId: session.id, topic: topics[i].title }, "Session created");
      }
    } catch (error) {
      logger.error({ error }, "Failed to generate initial topics");
    }
  }

  logger.info({ activeCount: activeSessions.size }, "Orchestrator initialized");
}

// Track sessions currently running an iteration (to prevent double-runs)
const sessionsRunning = new Set<string>();

/**
 * Start the orchestrator loop
 */
export async function startOrchestratorLoop(): Promise<void> {
  if (orchestratorRunning) {
    logger.warn("Orchestrator loop already running");
    return;
  }

  orchestratorRunning = true;
  logger.info("Starting orchestrator loop");

  while (orchestratorRunning) {
    // Collect sessions that need iteration
    const sessionsToRun: DemoSession[] = [];

    for (const [sessionId, session] of activeSessions) {
      // Skip if session is not active
      if (session.status !== "active") {
        continue;
      }

      // Skip if session is already running an iteration
      if (sessionsRunning.has(sessionId)) {
        continue;
      }

      // Check if session needs iteration
      const lastDecision = session.orchestratorDecisions[session.orchestratorDecisions.length - 1];
      const needsIteration =
        session.currentIteration === 0 || // First iteration
        (lastDecision && lastDecision.decision !== "CONCLUDE"); // Not concluded

      if (needsIteration) {
        sessionsToRun.push(session);
      }
    }

    // Run all needed iterations IN PARALLEL
    if (sessionsToRun.length > 0) {
      logger.info({ count: sessionsToRun.length }, "Starting parallel iterations");

      await Promise.all(
        sessionsToRun.map(async (session) => {
          sessionsRunning.add(session.id);
          try {
            await runIteration(session);
            // Refresh session from our local map (it may have been updated)
            const updatedSession = activeSessions.get(session.id);
            if (updatedSession) {
              activeSessions.set(session.id, updatedSession);
            }
          } catch (error) {
            logger.error({ sessionId: session.id, error }, "Iteration error");
          } finally {
            sessionsRunning.delete(session.id);
          }
        })
      );
    }

    // Wait before next loop iteration
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

/**
 * Stop the orchestrator loop
 */
export function stopOrchestratorLoop(): void {
  orchestratorRunning = false;
  logger.info("Orchestrator loop stopped");
}

/**
 * Restart with fresh topics
 */
export async function restart(): Promise<void> {
  logger.info("Restarting orchestrator with fresh topics");

  // Stop the loop temporarily
  const wasRunning = orchestratorRunning;
  orchestratorRunning = false;

  // Clear active sessions and running tracker
  await deleteAllActiveSessions();
  activeSessions.clear();
  sessionsRunning.clear();

  // Reinitialize
  await initialize();

  // Restart loop if it was running
  if (wasRunning) {
    startOrchestratorLoop();
  }
}

/**
 * Get current active sessions (for API)
 */
export function getActiveSessionsFromMemory(): DemoSession[] {
  return Array.from(activeSessions.values());
}

/**
 * Get a single session by ID
 */
export function getSessionFromMemory(id: string): DemoSession | undefined {
  return activeSessions.get(id);
}
