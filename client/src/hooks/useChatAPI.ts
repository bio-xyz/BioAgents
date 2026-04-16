import { useState } from "preact/hooks";
import { useToast } from "./useToast";

/**
 * Get the JWT auth token for API authentication
 * Returns the JWT token issued by the server after successful login
 *
 * SECURITY NOTE:
 * - The JWT is signed by the server using BIOAGENTS_SECRET
 * - BIOAGENTS_SECRET never leaves the server
 * - Only the signed JWT token is stored on the client
 * - The token contains userId and expiration, verified by signature
 */
function getAuthToken(): string | null {
  // Get JWT token from UI auth flow
  const authToken = localStorage.getItem("bioagents_auth_token");
  if (authToken) return authToken;

  return null;
}

export interface SendMessageParams {
  message: string;
  conversationId: string;
  userId: string;
  file?: File | null;
  files?: File[];
}

export interface ChatResponse {
  text: string;
  messageId?: string; // For deduplication with WebSocket
  files?: Array<{
    filename: string;
    mimeType: string;
    size?: number;
  }>;
}

export interface DeepResearchResponse {
  messageId: string | null;
  conversationId: string;
  status: "processing" | "rejected";
  error?: string;
}

export interface UseChatAPIReturn {
  isLoading: boolean;
  error: string;
  sendMessage: (params: SendMessageParams) => Promise<ChatResponse>;
  sendDeepResearchMessage: (
    params: SendMessageParams,
  ) => Promise<DeepResearchResponse>;
  clearError: () => void;
  clearLoading: () => void;
}

/**
 * Custom hook for chat API communication
 * Handles sending messages and receiving responses with support for multiple files
 */
export function useChatAPI(): UseChatAPIReturn {
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * Poll for job result (queue mode)
   * Used when USE_JOB_QUEUE=true - server returns job ID and we poll until complete
   *
   * @param pollUrl - The URL to poll for status
   * @param _jobId - Job ID (for logging)
   * @param maxAttempts - Max polling attempts (default: 180 = 3 min for chat)
   * @param intervalMs - Interval between polls in ms (default: 1000 = 1s)
   */
  const pollForResult = async (
    pollUrl: string,
    messageId: string,
    maxAttempts = 180, // 3 minutes for regular chat
    intervalMs = 1000,
  ): Promise<{ text: string; messageId: string; files?: ChatResponse["files"] }> => {
    const authToken = getAuthToken();
    const headers: Record<string, string> = {};
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(pollUrl, {
          method: "GET",
          headers,
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`Poll failed: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[useChatAPI] Poll attempt ${attempt + 1}:`, data.status);

        if (data.status === "completed" && data.result) {
          return {
            text: data.result.text || data.result.response || "",
            messageId,
            files: data.result.files,
          };
        }

        if (data.status === "failed") {
          throw new Error(data.error || "Job failed");
        }

        // Still processing, wait and retry
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (err) {
        console.error(`[useChatAPI] Poll error:`, err);
        throw err;
      }
    }

    throw new Error("Job timed out waiting for result");
  };

  /**
   * Send a chat message to the API
   */
  const sendMessage = async (
    params: SendMessageParams,
  ): Promise<ChatResponse> => {
    setIsLoading(true);
    setError("");

    const { message, conversationId, userId, file, files } = params;

    try {
      const formData = new FormData();
      formData.append("message", message || "");
      formData.append("conversationId", conversationId);

      // Ensure we always send a valid userId
      const validUserId = userId && userId.length > 0 ? userId : null;
      if (validUserId) {
        formData.append("userId", validUserId);
        console.log("[useChatAPI] Sending with userId:", validUserId);
      } else {
        console.warn("[useChatAPI] No valid userId provided!");
      }

      // Support both single file (legacy) and multiple files
      if (files && files.length > 0) {
        files.forEach((f) => {
          formData.append("files", f);
        });
      } else if (file) {
        formData.append("files", file);
      }

      // Build headers with auth
      const headers: Record<string, string> = {};
      const authToken = getAuthToken();
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers,
      });

      // Handle 401 Unauthorized - session expired
      if (response.status === 401) {
        window.location.reload();
        throw new Error("Session expired. Please log in again.");
      }

      const data = await response.json();

      // Handle error response from backend
      if (!response.ok || (data.ok === false && data.error)) {
        const errorMsg = data.error || `HTTP error! status: ${response.status}`;
        throw new Error(errorMsg);
      }

      // Handle queue mode response (USE_JOB_QUEUE=true)
      if (data.status === "queued" && data.pollUrl) {
        console.log("[useChatAPI] Queue mode detected, polling for result...", data);
        const result = await pollForResult(data.pollUrl, data.messageId);
        return {
          text: result.text,
          messageId: result.messageId,
          files: result.files,
        };
      }

      if (!data.text) {
        throw new Error("No response text received");
      }

      return {
        text: data.text,
        files: data.files,
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to send message. Please try again.";
      setError(errorMessage);

      if (!errorMessage.includes("Session expired")) {
        toast.error(`❌ Error: ${errorMessage}`, 6000);
      }

      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Send a deep research request to the API
   */
  const sendDeepResearchMessage = async (
    params: SendMessageParams,
  ): Promise<DeepResearchResponse> => {
    setIsLoading(true);
    setError("");

    const { message, conversationId, userId, file, files } = params;

    try {
      const formData = new FormData();
      formData.append("message", message || "");
      formData.append("conversationId", conversationId);

      // Ensure we always send a valid userId
      const validUserId = userId && userId.length > 0 ? userId : null;
      if (validUserId) {
        formData.append("userId", validUserId);
        console.log("[useChatAPI] Deep research with userId:", validUserId);
      } else {
        console.warn("[useChatAPI] No valid userId for deep research!");
      }

      // Support both single file (legacy) and multiple files
      if (files && files.length > 0) {
        files.forEach((f) => {
          formData.append("files", f);
        });
      } else if (file) {
        formData.append("files", file);
      }

      // Build headers with auth
      const headers: Record<string, string> = {};
      const authToken = getAuthToken();
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch("/api/deep-research/start", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers,
      });

      // Handle 401 Unauthorized
      if (response.status === 401) {
        window.location.reload();
        throw new Error("Session expired. Please log in again.");
      }

      const data = await response.json();

      // If validation failed (status 400 with rejected status), return the error
      if (response.status === 400 && data.status === "rejected") {
        return {
          messageId: null,
          conversationId: data.conversationId,
          status: "rejected",
          error: data.error,
        };
      }

      // Handle other errors
      if (!response.ok) {
        const errorMsg = data.error || `HTTP error! status: ${response.status}`;
        throw new Error(errorMsg);
      }

      // Handle queue mode response (USE_JOB_QUEUE=true)
      // For deep research, "queued" is equivalent to "processing" - results come via message polling
      if (data.status === "queued") {
        console.log("[useChatAPI] Deep research queued:", data);
      }

      return {
        messageId: data.messageId ?? null,
        conversationId: data.conversationId ?? conversationId,
        status: "processing",
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to start deep research. Please try again.";
      setError(errorMessage);
      setIsLoading(false);

      if (!errorMessage.includes("Session expired")) {
        toast.error(`❌ Error: ${errorMessage}`, 6000);
      }

      throw err;
    } finally {
      // Don't set isLoading false here on success — deep research runs in background.
      // isLoading is cleared by clearLoading() when the background job completes.
    }
  };

  /**
   * Clear error message
   */
  const clearError = () => {
    setError("");
  };

  /**
   * Clear loading state (used when deep research completes externally)
   */
  const clearLoading = () => {
    setIsLoading(false);
  };

  return {
    isLoading,
    error,
    sendMessage,
    sendDeepResearchMessage,
    clearError,
    clearLoading,
  };
}
