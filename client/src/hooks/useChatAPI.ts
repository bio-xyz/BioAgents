import { useState } from "preact/hooks";
import { useX402Payment, type UseX402PaymentReturn } from "./useX402Payment";
import { useToast } from "./useToast";

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

export interface PaymentConfirmationRequest {
  amount: string;
  currency: string;
  network: string;
}

export interface UseChatAPIReturn {
  isLoading: boolean;
  error: string;
  sendMessage: (params: SendMessageParams) => Promise<ChatResponse>;
  clearError: () => void;
  paymentTxHash: string | null;
  pendingPayment: PaymentConfirmationRequest | null;
  confirmPayment: () => Promise<ChatResponse | null>;
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
  const [pendingPayment, setPendingPayment] = useState<PaymentConfirmationRequest | null>(null);
  const [pendingMessageParams, setPendingMessageParams] = useState<SendMessageParams | null>(null);
  const {
    fetchWithPayment,
    decodePaymentResponse,
    config: x402Config,
  } = x402Context ?? useX402Payment();

  /**
   * Internal function to actually send the message (after confirmation if needed)
   */
  const sendMessageInternal = async (params: SendMessageParams, skipPaymentCheck = false): Promise<ChatResponse> => {
    const { message, conversationId, userId, file, files } = params;

    try {
      const formData = new FormData();
      formData.append("message", message || "");
      formData.append("conversationId", conversationId);
      formData.append("userId", userId);

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

      if (!skipPaymentCheck) {
        // First try without payment to see if it's required
        response = await fetch("/api/chat", {
          method: "POST",
          body: formData,
          credentials: "include",
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

          // Set pending payment for confirmation
          setPendingPayment({
            amount,
            currency: x402Config?.asset || "USDC",
            network: x402Config?.network || "base-sepolia",
          });
          setPendingMessageParams(params);
          setIsLoading(false);

          // Throw special error to stop processing
          const confirmError: any = new Error("PAYMENT_CONFIRMATION_REQUIRED");
          confirmError.isPaymentConfirmation = true;
          throw confirmError;
        }
      } else {
        // User confirmed, use payment-enabled fetch
        response = await fetchWithPayment("/api/chat", {
          method: "POST",
          body: formData,
          credentials: "include",
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
          8000
        );
        throw new Error("💳 Payment failed. Please ensure you have sufficient USDC balance.");
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
              7000
            );

            console.log("[useChatAPI] Payment successful - Transaction:", paymentResponse.transaction);
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
      if (!errorMessage.includes("Payment Required") && !errorMessage.includes("Session expired")) {
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
  const sendMessage = async (params: SendMessageParams): Promise<ChatResponse> => {
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
    setPendingMessageParams(null);
    setIsLoading(false);
    setError("");
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
    paymentTxHash,
    pendingPayment,
    confirmPayment,
    cancelPayment,
  };
}
