import type { JSX } from "preact";

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (mode: string) => void;
  disabled?: boolean;
  placeholder?: string;
  selectedFile?: File | null;
  selectedFiles?: File[];
  onFileSelect: (fileOrFiles: File | File[]) => void;
  onFileRemove: (index?: number) => void;
  onModeChange?: (mode: "normal" | "deep") => void;
  defaultMode?: "normal" | "deep";
  conversationMode?: "normal" | "deep";
  isNewConversation?: boolean;
}

export function ChatInput(props: ChatInputProps): JSX.Element;
