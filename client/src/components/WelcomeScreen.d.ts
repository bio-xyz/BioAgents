import type { JSX } from "preact";

export interface WelcomeScreenProps {
  onExampleClick?: (text: string) => void;
}

export function WelcomeScreen(props: WelcomeScreenProps): JSX.Element;
