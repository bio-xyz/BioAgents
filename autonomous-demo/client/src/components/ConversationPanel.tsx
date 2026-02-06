// Single conversation panel with messages and state side by side
import { useState, useEffect, useRef } from "preact/hooks";
import { StatePanel } from "./StatePanel";

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
}

interface Message {
  id: string;
  role: "orchestrator" | "main_server" | "system";
  content: string;
  createdAt: string;
  metadata?: {
    type?: "continuation" | "iteration_start" | "iteration_complete";
    iteration?: number;
  };
}

interface ConversationState {
  currentObjective?: string;
  currentHypothesis?: string;
  keyInsights?: string[];
  discoveries?: Array<{
    title: string;
    claim: string;
    summary: string;
  }>;
  plan?: any[];
  suggestedNextSteps?: string[];
  [key: string]: any;
}

interface SessionDetailResponse {
  session: Session;
  messages: Message[];
  conversationState?: ConversationState;
}

interface Props {
  session: Session;
}

export function ConversationPanel({ session }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationState, setConversationState] = useState<ConversationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showState, setShowState] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchSessionDetails = async () => {
    try {
      const response = await fetch(`/api/sessions/${session.id}`);
      if (!response.ok) return;

      const data: SessionDetailResponse = await response.json();
      setMessages(data.messages || []);
      setConversationState(data.conversationState || null);
    } catch (err) {
      console.error("Failed to fetch session details:", err);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchSessionDetails();
  }, [session.id]);

  // Poll for updates
  useEffect(() => {
    const interval = setInterval(fetchSessionDetails, 3000);
    return () => clearInterval(interval);
  }, [session.id]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const getStatusClass = (status: string) => {
    switch (status) {
      case "active": return "status-active";
      case "archiving": return "status-archiving";
      case "archived": return "status-archived";
      default: return "";
    }
  };

  const getMessageClass = (message: Message) => {
    // Check for continuation/system messages
    if (message.role === "system") return "message-system";
    if (message.metadata?.type === "continuation") return "message-continuation";
    if (message.metadata?.type === "iteration_start") return "message-iteration-start";
    if (message.metadata?.type === "iteration_complete") return "message-iteration-complete";

    // Check content patterns for continuation
    const content = message.content.toLowerCase();
    if (content.includes("agent continued") || content.includes("continuing research")) {
      return "message-continuation";
    }

    return message.role === "orchestrator" ? "message-orchestrator" : "message-server";
  };

  const getMessageLabel = (message: Message) => {
    if (message.role === "system") return "System";
    if (message.metadata?.type === "continuation") return "Agent Continued";
    if (message.metadata?.type === "iteration_start") return `Iteration ${message.metadata.iteration || ''}`;
    if (message.metadata?.type === "iteration_complete") return "Iteration Complete";

    // Check content for continuation pattern
    const content = message.content.toLowerCase();
    if (content.includes("agent continued") || content.includes("continuing research")) {
      return "Agent Continued";
    }

    return message.role === "orchestrator" ? "Orchestrator" : "Research Agent";
  };

  return (
    <div class="conversation-panel-wrapper">
      {/* Header */}
      <div class="panel-header">
        <div class="header-top">
          <h2>
            {session.topic.title}
            <span class={`status-badge ${getStatusClass(session.status)}`}>
              {session.status}
            </span>
          </h2>
          <button
            class={`toggle-state-btn ${showState ? 'active' : ''}`}
            onClick={() => setShowState(!showState)}
            title={showState ? "Hide State" : "Show State"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
          </button>
        </div>
        <p class="topic">{session.topic.researchQuestion}</p>
        <div class="header-meta">
          <span class="iteration">Iteration {session.currentIteration}</span>
          {conversationState?.plan && (
            <span class="plan-status">
              {conversationState.plan.filter((t: any) => t.end).length}/{conversationState.plan.length} tasks
            </span>
          )}
        </div>
      </div>

      {/* Content area - split or full width */}
      <div class={`panel-content ${showState ? 'split' : 'full'}`}>
        {/* Messages */}
        <div class="messages-section">
          <div class="messages-container">
            {loading ? (
              <div class="loading">
                <div class="spinner" />
              </div>
            ) : messages.length === 0 ? (
              <div class="empty-state">
                Waiting for first message...
              </div>
            ) : (
              messages.map((message, index) => (
                <div key={message.id}>
                  {/* Add iteration separator if this is a new iteration */}
                  {message.metadata?.type === "iteration_start" && index > 0 && (
                    <div class="iteration-separator">
                      <span>Iteration {message.metadata.iteration}</span>
                    </div>
                  )}
                  <div class={`message ${getMessageClass(message)}`}>
                    <div class="message-role">{getMessageLabel(message)}</div>
                    <div class="message-content">
                      <MessageContent content={message.content} />
                    </div>
                    <div class="message-time">
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* State Panel */}
        {showState && (
          <div class="state-section">
            <StatePanel state={conversationState} />
          </div>
        )}
      </div>
    </div>
  );
}

// Message content with expandable sections
function MessageContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const maxLength = 800;
  const isLong = content.length > maxLength;

  const displayContent = expanded ? content : content.slice(0, maxLength);

  return (
    <>
      <div class="content-text">{displayContent}</div>
      {isLong && (
        <button class="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : `Show more (${content.length - maxLength} chars)`}
        </button>
      )}
    </>
  );
}
