import { useState } from 'preact/hooks';

export interface UseTypingAnimationReturn {
  isTyping: boolean;
  animateText: (
    text: string,
    onUpdate: (currentText: string) => void,
    onComplete?: () => void
  ) => Promise<void>;
}

/**
 * Custom hook for typing animation effect
 * Simulates a typing effect for bot messages
 */
export function useTypingAnimation(): UseTypingAnimationReturn {
  const [isTyping, setIsTyping] = useState(false);

  /**
   * Animate text with typing effect
   */
  const animateText = async (
    text: string,
    onUpdate: (currentText: string) => void,
    onComplete?: () => void
  ): Promise<void> => {
    setIsTyping(true);

    const chars = text.split('');
    let currentText = '';

    // Type 3 characters at a time for faster animation
    for (let i = 0; i < chars.length; i += 3) {
      currentText += chars.slice(i, i + 3).join('');
      onUpdate(currentText);
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // Ensure full text is displayed
    onUpdate(text);
    setIsTyping(false);

    if (onComplete) {
      onComplete();
    }
  };

  return {
    isTyping,
    animateText,
  };
}
