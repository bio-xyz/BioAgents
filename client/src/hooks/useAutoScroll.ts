import type { Ref } from "preact";
import { useEffect, useRef } from "preact/hooks";

export interface UseAutoScrollReturn {
  containerRef: Ref<HTMLDivElement>;
  scrollToBottom: () => void;
}

/**
 * Custom hook for auto-scrolling chat container
 * Automatically scrolls to bottom when new messages arrive
 */
export function useAutoScroll(dependencies: readonly unknown[] = []): UseAutoScrollReturn {
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Scroll to bottom of container
   */
  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  // Auto-scroll when dependencies change (e.g., new messages)
  useEffect(() => {
    scrollToBottom();
  }, dependencies);

  return {
    containerRef,
    scrollToBottom,
  };
}
