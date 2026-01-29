// Demo page with 3 conversation panels
import { useState, useEffect } from "preact/hooks";
import { ConversationPanel } from "../components/ConversationPanel";

interface Session {
  id: string;
  conversationId: string;
  topic: {
    title: string;
    researchQuestion: string;
    background: string;
  };
  status: string;
  currentIteration: number;
  createdAt: string;
  updatedAt: string;
}

interface SessionsResponse {
  sessions: Session[];
}

export function DemoPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = async () => {
    try {
      const response = await fetch("/api/sessions");
      if (!response.ok) {
        throw new Error("Failed to fetch sessions");
      }
      const data: SessionsResponse = await response.json();
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
      setError("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchSessions();
  }, []);

  // Poll for updates every 5 seconds
  useEffect(() => {
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div class="main-content">
        <div class="loading" style={{ gridColumn: "1 / -1" }}>
          <div class="spinner" />
          Loading sessions...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div class="main-content">
        <div class="empty-state" style={{ gridColumn: "1 / -1" }}>
          {error}
          <br />
          <button class="btn" onClick={fetchSessions} style={{ marginTop: "1rem" }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div class="main-content">
        <div class="empty-state" style={{ gridColumn: "1 / -1" }}>
          No active research sessions.
          <br />
          The orchestrator is generating topics...
        </div>
      </div>
    );
  }

  // Pad to always show 3 panels
  const displaySessions = [...sessions];
  while (displaySessions.length < 3) {
    displaySessions.push(null as any);
  }

  return (
    <div class="main-content">
      {displaySessions.slice(0, 3).map((session, index) =>
        session ? (
          <ConversationPanel key={session.id} session={session} />
        ) : (
          <div key={`empty-${index}`} class="conversation-panel">
            <div class="empty-state">
              Waiting for topic...
            </div>
          </div>
        )
      )}
    </div>
  );
}
