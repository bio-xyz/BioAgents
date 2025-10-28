import { useState } from "preact/hooks";

export interface SendMessageParams {
  message: string;
  conversationId: string;
  userId: string;
  file?: File | null;
  files?: File[];
}

export interface ChatResponse {
  text: string;
  files?: Array<{
    filename: string;
    mimeType: string;
    size?: number;
  }>;
}

export interface UseChatAPIReturn {
  isLoading: boolean;
  error: string;
  sendMessage: (params: SendMessageParams) => Promise<ChatResponse>;
  clearError: () => void;
}

/**
 * Custom hook for chat API communication
 * Handles sending messages and receiving responses with support for multiple files
 */
export function useChatAPI(): UseChatAPIReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * Send a message to the chat API
   */
  const sendMessage = async ({
    message,
    conversationId,
    userId,
    file,
    files,
  }: SendMessageParams): Promise<ChatResponse> => {
    setIsLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("message", message || "");
      formData.append("conversationId", conversationId);
      formData.append("userId", userId);

      // Support both single file (legacy) and multiple files
      if (files && files.length > 0) {
        console.log(`[useChatAPI] Sending ${files.length} files:`, files.map(f => f.name));
        files.forEach((f) => {
          formData.append("files", f);
        });
      } else if (file) {
        console.log(`[useChatAPI] Sending 1 file:`, file.name);
        formData.append("files", file);
      } else {
        console.log(`[useChatAPI] No files to send`);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        body: formData,
        credentials: 'include', // Important: include cookies for auth
      });

      // Handle 401 Unauthorized - session expired
      if (response.status === 401) {
        // Redirect to login or reload page to show login screen
        window.location.reload();
        throw new Error("Session expired. Please log in again.");
      }

      const data = await response.json();

      // Handle error response from backend
      if (!response.ok || (data.ok === false && data.error)) {
        const errorMsg = data.error || `HTTP error! status: ${response.status}`;
        throw new Error(errorMsg);
      }

      if (!data.text) {
        throw new Error("No response text received");
      }

      return {
        text: data.text,
        files: data.files,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to send message. Please try again.";
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Clear error message
   */
  const clearError = () => {
    setError("");
  };

  return {
    isLoading,
    error,
    sendMessage,
    clearError,
  };
}
