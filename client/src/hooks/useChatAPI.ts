import { useState } from 'preact/hooks';

export interface SendMessageParams {
  message: string;
  conversationId: string;
  file?: File | null;
}

export interface UseChatAPIReturn {
  isLoading: boolean;
  error: string;
  sendMessage: (params: SendMessageParams) => Promise<string>;
  clearError: () => void;
}

/**
 * Custom hook for chat API communication
 * Handles sending messages and receiving responses
 */
export function useChatAPI(): UseChatAPIReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  /**
   * Send a message to the chat API
   */
  const sendMessage = async ({ message, conversationId, file }: SendMessageParams): Promise<string> => {
    setIsLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('message', message || '');
      formData.append('conversationId', conversationId);

      if (file) {
        formData.append('file', file);
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.text) {
        throw new Error('No response text received');
      }

      return data.text;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message. Please try again.';
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
    setError('');
  };

  return {
    isLoading,
    error,
    sendMessage,
    clearError,
  };
}
