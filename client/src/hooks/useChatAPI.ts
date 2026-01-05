import { useState } from "preact/hooks";
import type { WalletClient } from "viem";
import { useToast } from "./useToast";
import { useX402Payment, type UseX402PaymentReturn } from "./useX402Payment";

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
  walletClient?: WalletClient | null;
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

export interface PaymentConfirmationRequest {
  amount: string;
  currency: string;
  network: string;
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
  paymentTxHash: string | null;
  pendingPayment: PaymentConfirmationRequest | null;
  pendingPaymentType: "chat" | "deep-research" | null;
  confirmPayment: () => Promise<ChatResponse | null>;
  confirmDeepResearchPayment: () => Promise<DeepResearchResponse | null>;
  cancelPayment: () => void;
}

/**
 * Custom hook for chat API communication
 * Handles sending messages and receiving responses with support for multiple files
 */
export function useChatAPI(
  x402Context?: UseX402PaymentReturn,
): UseChatAPIReturn {
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentTxHash, setPaymentTxHash] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] =
    useState<PaymentConfirmationRequest | null>(null);
  const [pendingPaymentType, setPendingPaymentType] =
    useState<"chat" | "deep-research" | null>(null);
  const [pendingMessageParams, setPendingMessageParams] =
    useState<SendMessageParams | null>(null);
  const {
    fetchWithPayment,
    decodePaymentResponse,
    config: x402Config,
  } = x402Context ?? useX402Payment();

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
  ): Promise<{ text: string; messageId: string; files?: any[] }> => {
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
   * Internal function to actually send the message (after confirmation if needed)
   */
  const sendMessageInternal = async (
    params: SendMessageParams,
    skipPaymentCheck = false,
  ): Promise<ChatResponse> => {
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

      // First, check if payment is required by making a regular fetch
      let response: Response;

      // Build headers with auth
      const headers: Record<string, string> = {};
      const authToken = getAuthToken();
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      // Determine endpoint based on x402 payment status
      // When payments enabled, use /api/x402/chat (USDC on Base)
      // Otherwise, use /api/chat which requires API key auth
      const isPaymentEnabled = x402Config?.enabled === true;
      const chatEndpoint = isPaymentEnabled ? "/api/x402/chat" : "/api/chat";

      if (!skipPaymentCheck) {
        // First try without payment to see if it's required
        response = await fetch(chatEndpoint, {
          method: "POST",
          body: formData,
          credentials: "include",
          headers,
        });

        // If 402, show confirmation modal instead of automatically paying
        if (response.status === 402) {
          const errorData = await response.json().catch(() => ({}));

          // Extract payment amount from pricing header or response
          const pricingHeader = response.headers.get("x-pricing");
          let amount = "0.01"; // Default amount

          if (pricingHeader) {
            try {
              const pricing = JSON.parse(pricingHeader);
              amount = pricing.cost || pricing.price || "0.01";
            } catch (e) {
              // Use default
            }
          }

          // Set pending payment for confirmation (x402 uses USDC on Base)
          setPendingPayment({
            amount,
            currency: x402Config?.asset || "USDC",
            network: x402Config?.network || "base-sepolia",
          });
          setPendingPaymentType("chat");
          setPendingMessageParams(params);
          setIsLoading(false);

          // Throw special error to stop processing
          const confirmError: any = new Error("PAYMENT_CONFIRMATION_REQUIRED");
          confirmError.isPaymentConfirmation = true;
          throw confirmError;
        }
      } else {
        // User confirmed, use payment-enabled fetch
        response = await fetchWithPayment(chatEndpoint, {
          method: "POST",
          body: formData,
          credentials: "include",
          headers,
        });
      }

      // Handle 401 Unauthorized - session expired
      if (response.status === 401) {
        window.location.reload();
        throw new Error("Session expired. Please log in again.");
      }

      // Handle 402 after payment attempt
      if (response.status === 402) {
        toast.error(
          "💳 Payment failed. Please ensure you have sufficient USDC balance.",
          8000,
        );
        throw new Error(
          "💳 Payment failed. Please ensure you have sufficient USDC balance.",
        );
      }

      // x402-fetch automatically handles 402 responses
      // If we get here, either payment succeeded or no payment was needed

      // Check for payment response header
      const paymentResponseHeader = response.headers.get("x-payment-response");

      if (paymentResponseHeader) {
        try {
          const paymentResponse = decodePaymentResponse(paymentResponseHeader);

          // Payment response contains transaction hash
          if (paymentResponse?.transaction) {
            setPaymentTxHash(paymentResponse.transaction);

            // Show success toast with transaction link
            const network = paymentResponse.network || "base-sepolia";
            const txShort = `${paymentResponse.transaction.slice(0, 8)}...${paymentResponse.transaction.slice(-6)}`;

            toast.success(
              `✅ Payment Transaction Approved!\n\nYour payment has been successfully processed.\n\nTx: ${txShort}`,
              7000,
            );

            console.log(
              "[useChatAPI] Payment successful - Transaction:",
              paymentResponse.transaction,
            );

            // Refresh USDC balance after successful payment
            if (x402Context?.checkBalance) {
              setTimeout(() => {
                x402Context.checkBalance();
              }, 1000); // Wait 1 second for transaction to settle
            }
          }
        } catch (err) {
          console.warn("[useChatAPI] Failed to decode payment response:", err);
        }
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
    } catch (err: any) {
      // Don't show error for payment confirmation request
      if (err?.isPaymentConfirmation) {
        return { text: "", files: [] }; // Return empty response, modal will handle it
      }

      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to send message. Please try again.";
      setError(errorMessage);

      // Show error toast for non-payment errors
      if (
        !errorMessage.includes("Payment Required") &&
        !errorMessage.includes("Session expired")
      ) {
        toast.error(`❌ Error: ${errorMessage}`, 6000);
      }

      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Public sendMessage function - entry point for sending messages
   */
  const sendMessage = async (
    params: SendMessageParams,
  ): Promise<ChatResponse> => {
    setIsLoading(true);
    setError("");
    setPaymentTxHash(null);

    return sendMessageInternal(params, false);
  };

  /**
   * Confirm payment and proceed with sending message
   */
  const confirmPayment = async (): Promise<ChatResponse | null> => {
    if (!pendingMessageParams) return null;

    setPendingPayment(null);
    setPendingPaymentType(null);
    setIsLoading(true);

    try {
      const response = await sendMessageInternal(pendingMessageParams, true);
      return response;
    } finally {
      setPendingMessageParams(null);
    }
  };

  /**
   * Cancel pending payment
   */
  const cancelPayment = () => {
    setPendingPayment(null);
    setPendingPaymentType(null);
    setPendingMessageParams(null);
    setIsLoading(false);
    setError("");
  };

  /**
   * Internal function to actually send deep research (after confirmation if needed)
   */
  const sendDeepResearchInternal = async (
    params: SendMessageParams,
    skipPaymentCheck = false,
  ): Promise<DeepResearchResponse> => {
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

      // Determine endpoint based on x402 payment status
      const isPaymentEnabled = x402Config?.enabled === true;
      const deepResearchEndpoint = isPaymentEnabled
        ? "/api/x402/deep-research/start"
        : "/api/deep-research/start";

      let response: Response;

      if (!skipPaymentCheck) {
        // First try without payment to see if it's required
        response = await fetch(deepResearchEndpoint, {
          method: "POST",
          body: formData,
          credentials: "include",
          headers,
        });

        // If 402, show confirmation modal
        if (response.status === 402) {
          const errorData = await response.json().catch(() => ({}));

          // Extract payment amount from pricing header or response
          const pricingHeader = response.headers.get("x-pricing");
          let amount = "0.025"; // Default amount for deep research

          if (pricingHeader) {
            try {
              const pricing = JSON.parse(pricingHeader);
              amount = pricing.cost || pricing.price || "0.025";
            } catch (e) {
              // Use default
            }
          }

          // Set pending payment for confirmation (x402 uses USDC on Base)
          setPendingPayment({
            amount,
            currency: x402Config?.asset || "USDC",
            network: x402Config?.network || "base-sepolia",
          });
          setPendingPaymentType("deep-research");
          setPendingMessageParams(params);
          setIsLoading(false);

          // Throw special error to stop processing
          const confirmError: any = new Error("PAYMENT_CONFIRMATION_REQUIRED");
          confirmError.isPaymentConfirmation = true;
          throw confirmError;
        }
      } else {
        // User confirmed, use payment-enabled fetch
        console.log("[useChatAPI] Deep research with payment - using fetchWithPayment:", {
          endpoint: deepResearchEndpoint,
          hasFormData: !!formData,
        });
        response = await fetchWithPayment(deepResearchEndpoint, {
          method: "POST",
          body: formData,
          credentials: "include",
          headers,
        });
        console.log("[useChatAPI] Deep research response status:", response.status);
      }

      // Handle 401 Unauthorized
      if (response.status === 401) {
        window.location.reload();
        throw new Error("Session expired. Please log in again.");
      }

      // Handle 402 after payment attempt
      if (response.status === 402) {
        toast.error(
          "💳 Payment failed. Please ensure you have sufficient USDC balance.",
          8000,
        );
        throw new Error(
          "💳 Payment failed. Please ensure you have sufficient USDC balance.",
        );
      }

      // Check for payment response header
      const paymentResponseHeader = response.headers.get("x-payment-response");

      if (paymentResponseHeader) {
        try {
          const paymentResponse = decodePaymentResponse(paymentResponseHeader);

          if (paymentResponse?.transaction) {
            setPaymentTxHash(paymentResponse.transaction);

            const txShort = `${paymentResponse.transaction.slice(0, 8)}...${paymentResponse.transaction.slice(-6)}`;

            toast.success(
              `✅ Payment Transaction Approved!\n\nTx: ${txShort}`,
              7000,
            );

            console.log(
              "[useChatAPI] Deep research payment successful - Transaction:",
              paymentResponse.transaction,
            );

            // Refresh USDC balance after successful payment
            if (x402Context?.checkBalance) {
              setTimeout(() => {
                x402Context.checkBalance();
              }, 1000);
            }
          }
        } catch (err) {
          console.warn("[useChatAPI] Failed to decode payment response:", err);
        }
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
        return {
          messageId: data.messageId,
          conversationId: data.conversationId,
          status: "processing",
        };
      }

      // Success - research is processing
      // DON'T set isLoading to false - keep loading state active while research runs in background
      return {
        messageId: data.messageId,
        conversationId: data.conversationId,
        status: "processing",
      };
    } catch (err: any) {
      // Don't show error for payment confirmation request - return special status
      if (err?.isPaymentConfirmation) {
        // Return "payment_required" status so the UI knows to show the modal
        // and NOT treat this as a rejection error
        return {
          messageId: null,
          conversationId: params.conversationId,
          status: "processing" as const,  // Use "processing" so UI doesn't show error
          error: "PAYMENT_REQUIRED"
        };
      }

      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to start deep research. Please try again.";
      setError(errorMessage);

      if (
        !errorMessage.includes("Payment Required") &&
        !errorMessage.includes("Session expired")
      ) {
        toast.error(`❌ Error: ${errorMessage}`, 6000);
      }

      throw err;
    } finally {
      // Don't set isLoading false here for deep research - it runs in background
      // Only the error path above sets it to false
    }
  };

  /**
   * Public sendDeepResearchMessage function - entry point
   */
  const sendDeepResearchMessage = async (
    params: SendMessageParams,
  ): Promise<DeepResearchResponse> => {
    setIsLoading(true);
    setError("");
    setPaymentTxHash(null);

    return sendDeepResearchInternal(params, false);
  };

  /**
   * Confirm payment and proceed with deep research
   */
  const confirmDeepResearchPayment = async (): Promise<DeepResearchResponse | null> => {
    console.log("[useChatAPI] confirmDeepResearchPayment called, params:", pendingMessageParams);
    if (!pendingMessageParams) {
      console.error("[useChatAPI] No pending message params!");
      return null;
    }

    setPendingPayment(null);
    setPendingPaymentType(null);
    setIsLoading(true);

    try {
      console.log("[useChatAPI] Calling sendDeepResearchInternal with skipPaymentCheck=true");
      const response = await sendDeepResearchInternal(pendingMessageParams, true);
      console.log("[useChatAPI] confirmDeepResearchPayment response:", response);
      setPendingMessageParams(null);
      return response;
    } catch (err) {
      console.error("[useChatAPI] confirmDeepResearchPayment error:", err);
      setIsLoading(false);
      throw err;
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
    paymentTxHash,
    pendingPayment,
    pendingPaymentType,
    confirmPayment,
    confirmDeepResearchPayment,
    cancelPayment,
  };
}
