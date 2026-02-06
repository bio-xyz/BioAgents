// HTTP client for communicating with the main BioAgents server

import { config } from "../utils/config";
import logger from "../utils/logger";
import type { ConversationStateValues } from "./orchestrator/types";
import { getMainServerMessage } from "../db/operations";

interface DeepResearchStartResponse {
  messageId: string;
  conversationId: string;
  userId: string;
  status: "processing" | "queued";
  pollUrl?: string;
  jobId?: string;
}

interface DeepResearchStatusResponse {
  status: "processing" | "completed" | "failed";
  messageId: string;
  conversationId: string;
  result?: {
    text: string;
    papers?: Array<{ doi: string; title: string }>;
  };
  error?: string;
  progress?: {
    currentStep?: string;
    completedSteps?: string[];
  };
}

interface ConversationStateResponse {
  id: string;
  values: ConversationStateValues;
}

interface PaperGenerationResponse {
  success: boolean;
  paperId: string;
  pdfUrl?: string;
  rawLatexUrl?: string;
  error?: string;
}

// Demo user ID for autonomous mode - consistent across all requests
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000000";

export class MainServerClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.mainServerUrl;
  }

  /**
   * Get API key at runtime (not at module load time)
   */
  private get apiKey(): string {
    return process.env.BIOAGENTS_SECRET || "";
  }

  /**
   * Get common headers for all requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    return headers;
  }

  /**
   * Start a deep research job
   */
  async startDeepResearch(
    message: string,
    conversationId?: string
  ): Promise<DeepResearchStartResponse> {
    const url = `${this.baseUrl}/api/deep-research/start`;

    logger.info({ url, message: message.substring(0, 100), conversationId }, "Starting deep research");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          message,
          conversationId,
          userId: DEMO_USER_ID, // Use demo user for API key auth
          fullyAutonomous: false, // We want to steer each iteration
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, errorText, url }, "Main server returned error");
        throw new Error(`Failed to start deep research: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      logger.info({ messageId: result.messageId }, "Deep research started successfully");
      return result;
    } catch (error) {
      logger.error({ error: String(error), url }, "Failed to connect to main server");
      throw error;
    }
  }

  /**
   * Poll for deep research status
   */
  async getStatus(messageId: string): Promise<DeepResearchStatusResponse> {
    // Include userId as query param for ownership validation (GET requests don't have body)
    const url = `${this.baseUrl}/api/deep-research/status/${messageId}?userId=${DEMO_USER_ID}`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get status: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Poll until research iteration completes
   * Checks the message directly from DB - when response_time is set, it's done
   */
  async waitForCompletion(
    messageId: string,
    onProgress?: (status: string) => void
  ): Promise<DeepResearchStatusResponse> {
    const maxAttempts = config.maxPollAttempts;
    const intervalMs = config.pollIntervalMs;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check the message directly from DB
      const message = await getMainServerMessage(messageId);

      if (!message) {
        logger.warn({ messageId, attempt }, "Message not found, waiting...");
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      // Message is complete when response_time is set
      if (message.response_time && message.content) {
        logger.info({ messageId, attempt }, "Research iteration completed");
        return {
          status: "completed",
          messageId,
          conversationId: message.conversation_id,
          result: {
            text: message.content,
          },
        };
      }

      if (onProgress) {
        onProgress(`Polling... attempt ${attempt + 1}/${maxAttempts}`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timeout waiting for research completion after ${maxAttempts} attempts`);
  }

  /**
   * Get conversation state
   */
  async getConversationState(conversationId: string): Promise<ConversationStateResponse | null> {
    const url = `${this.baseUrl}/api/deep-research/conversations/${conversationId}/state`;

    try {
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get conversation state: ${response.status} - ${error}`);
      }

      return response.json();
    } catch (error) {
      logger.warn({ conversationId, error }, "Failed to fetch conversation state");
      return null;
    }
  }

  /**
   * Generate paper from conversation
   */
  async generatePaper(conversationId: string): Promise<PaperGenerationResponse> {
    const url = `${this.baseUrl}/api/deep-research/conversations/${conversationId}/paper`;

    logger.info({ conversationId }, "Triggering paper generation");

    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        userId: DEMO_USER_ID, // Include userId for API key auth
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to generate paper: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Get paper status and URLs
   */
  async getPaper(paperId: string): Promise<{
    paperId: string;
    pdfUrl?: string;
    rawLatexUrl?: string;
    status: string;
  }> {
    // Include userId as query param for ownership validation (GET requests don't have body)
    const url = `${this.baseUrl}/api/deep-research/paper/${paperId}?userId=${DEMO_USER_ID}`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get paper: ${response.status} - ${error}`);
    }

    return response.json();
  }
}

// Singleton instance
export const mainServerClient = new MainServerClient();
