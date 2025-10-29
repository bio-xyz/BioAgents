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

export interface UseChatAPIReturn {
  isLoading: boolean;
  error: string;
  sendMessage: (params: SendMessageParams) => Promise<ChatResponse>;
  clearError: () => void;
  paymentTxHash: string | null;
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
  const {
    fetchWithPayment,
    decodePaymentResponse,
  } = x402Context ?? useX402Payment();

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
    setPaymentTxHash(null);

    try {
      const formData = new FormData();
      formData.append("message", message || "");
      formData.append("conversationId", conversationId);
      formData.append("userId", userId);

      // Support both single file (legacy) and multiple files
      if (files && files.length > 0) {
        console.log(
          `[useChatAPI] Sending ${files.length} files:`,
          files.map(f => f.name),
        );
        files.forEach((f) => {
          formData.append("files", f);
        });
      } else if (file) {
        console.log(`[useChatAPI] Sending 1 file:`, file.name);
        formData.append("files", file);
      } else {
        console.log(`[useChatAPI] No files to send`);
      }

      console.log("[useChatAPI] Sending message to /api/chat");
      
      // Use wrapped fetch that handles x402 payments automatically
      let response;
      try {
        response = await fetchWithPayment("/api/chat", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
      } catch (err) {
        console.error("[useChatAPI] Fetch error:", err);
        // If x402-fetch fails, it might throw an error
        // Check if it's a payment-related error
        if (err.message?.includes("payment") || err.message?.includes("402")) {
          throw new Error("💳 Payment failed. Please connect your wallet and ensure you have sufficient USDC balance.");
        }
        throw err;
      }

      // Handle 401 Unauthorized - session expired
      if (response.status === 401) {
        window.location.reload();
        throw new Error("Session expired. Please log in again.");
      }

      // Handle 402 - payment required (wallet not connected or x402-fetch didn't handle it)
      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}));
        
        // Show toast notification
        toast.error(
          "💳 Payment Required\n\nThis action requires payment. Please connect your wallet to continue.\n\nIf your wallet is already connected, ensure you have sufficient USDC balance.",
          8000
        );
        
        // Show a clear message to connect wallet
        throw new Error(
          "💳 Payment Required\n\nThis action requires payment. Please connect your wallet to continue.\n\nIf your wallet is already connected, ensure you have sufficient USDC balance."
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
            const explorerUrl = network.includes("sepolia")
              ? `https://sepolia.basescan.org/tx/${paymentResponse.transaction}`
              : `https://basescan.org/tx/${paymentResponse.transaction}`;
            
            toast.success(
              `✅ Payment Confirmed\n\nTransaction: ${paymentResponse.transaction.slice(0, 10)}...${paymentResponse.transaction.slice(-8)}`,
              5000
            );
            
            // Show processing toast after payment
            setTimeout(() => {
              toast.info(
                `🧠 BioAgent Processing\n\nYour request has been received and is being analyzed. Please wait while we generate your response.`,
                6000
              );
            }, 500);
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
    } catch (err) {
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
  };
}
