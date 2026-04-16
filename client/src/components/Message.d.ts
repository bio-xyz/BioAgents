import type { JSX } from "preact";
import type { Message as ChatMessage } from "../hooks/useSessions";

export interface MessageProps {
  message: ChatMessage;
}

export function Message(props: MessageProps): JSX.Element;
