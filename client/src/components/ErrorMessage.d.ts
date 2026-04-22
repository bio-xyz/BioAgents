import type { JSX } from "preact";

export interface ErrorMessageProps {
  message: string;
  onClose?: () => void;
  type?: "error" | "warning" | "info";
}

export function ErrorMessage(props: ErrorMessageProps): JSX.Element;
