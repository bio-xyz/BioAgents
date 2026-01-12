// Archive page showing completed research sessions
import { useState, useEffect } from "preact/hooks";

interface ArchivedSession {
  id: string;
  conversationId: string;
  topic: {
    title: string;
    researchQuestion: string;
    background: string;
  };
  status: string;
  currentIteration: number;
  paperId?: string;
  paperUrl?: string;
  createdAt: string;
  archivedAt?: string;
}

interface ArchiveResponse {
  sessions: ArchivedSession[];
}

export function ArchivePage() {
  const [sessions, setSessions] = useState<ArchivedSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArchive = async () => {
      try {
        const response = await fetch("/api/archive");
        if (!response.ok) {
          throw new Error("Failed to fetch archive");
        }
        const data: ArchiveResponse = await response.json();
        setSessions(data.sessions);
      } catch (err) {
        console.error("Failed to fetch archive:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchArchive();
  }, []);

  if (loading) {
    return (
      <div class="archive-page">
        <h2>Archived Research</h2>
        <div class="loading">
          <div class="spinner" />
          Loading archive...
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div class="archive-page">
        <h2>Archived Research</h2>
        <div class="empty-state">
          No archived research sessions yet.
          <br />
          Sessions are archived when the orchestrator determines research is complete.
        </div>
      </div>
    );
  }

  return (
    <div class="archive-page">
      <h2>Archived Research</h2>
      <p style={{ color: "var(--text-secondary)", marginBottom: "1rem" }}>
        {sessions.length} completed research session{sessions.length !== 1 ? "s" : ""}
      </p>

      <div class="archive-grid">
        {sessions.map((session) => (
          <div key={session.id} class="archive-card">
            <h3>{session.topic.title}</h3>
            <p class="question">{session.topic.researchQuestion}</p>
            <div class="meta">
              <span>{session.currentIteration} iterations</span>
              <span>
                {session.archivedAt
                  ? new Date(session.archivedAt).toLocaleDateString()
                  : "N/A"}
              </span>
            </div>
            {session.paperUrl && (
              <a
                href={session.paperUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="paper-link"
                style={{ marginTop: "0.75rem", display: "inline-flex" }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                View Paper
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
