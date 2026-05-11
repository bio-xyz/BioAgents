import type { JSX } from "preact";
import type { Session } from "../hooks/useSessions";

export interface SidebarProps {
  sessions: Session[];
  currentSessionId: string;
  onSessionSelect: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar(props: SidebarProps): JSX.Element;
