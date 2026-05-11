import type { JSX } from "preact";

export interface LoginScreenProps {
  onLogin: (password: string) => Promise<boolean>;
}

export function LoginScreen(props: LoginScreenProps): JSX.Element;
