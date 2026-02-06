// Research State Panel - Full panel with collapsible sections
import { useState } from "preact/hooks";

interface PlanTask {
  id: string;
  type: string;
  objective: string;
  start?: string;
  end?: string;
  output?: string;
  datasets?: any[];
}

interface Discovery {
  title: string;
  claim: string;
  summary: string;
  supportingEvidence?: any[];
}

interface ConversationState {
  currentObjective?: string;
  currentHypothesis?: string;
  keyInsights?: string[];
  discoveries?: Discovery[];
  plan?: PlanTask[];
  suggestedNextSteps?: string[];
  methodology?: string;
  conversationTitle?: string;
  [key: string]: any; // Allow other properties
}

interface Props {
  state: ConversationState | null;
}

// Collapsible section component
function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: any;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div class="state-section-wrapper">
      <button
        class={`section-toggle ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span class="section-title">
          {title}
          {count !== undefined && count > 0 && (
            <span class="section-count">{count}</span>
          )}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && <div class="section-content">{children}</div>}
    </div>
  );
}

// JSON viewer with expand/collapse
function JsonViewer({ data, maxHeight = "200px" }: { data: any; maxHeight?: string }) {
  const [expanded, setExpanded] = useState(false);
  const jsonString = JSON.stringify(data, null, 2);
  const isLong = jsonString.length > 500;

  return (
    <div class="json-viewer">
      <pre style={{ maxHeight: expanded ? "none" : maxHeight }}>
        {jsonString}
      </pre>
      {isLong && (
        <button class="json-expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}

// Plan task display
function PlanTaskItem({ task }: { task: PlanTask }) {
  const [showOutput, setShowOutput] = useState(false);
  const isComplete = !!task.end;
  const isRunning = task.start && !task.end;

  return (
    <div class={`plan-task ${isComplete ? 'complete' : ''} ${isRunning ? 'running' : ''}`}>
      <div class="task-header">
        <span class={`task-type ${task.type.toLowerCase()}`}>{task.type}</span>
        <span class="task-status">
          {isRunning && <span class="status-dot running" />}
          {isComplete && <span class="status-dot complete" />}
          {!task.start && <span class="status-dot pending" />}
        </span>
      </div>
      <div class="task-objective">{truncate(task.objective, 150)}</div>
      {task.output && (
        <>
          <button class="task-output-toggle" onClick={() => setShowOutput(!showOutput)}>
            {showOutput ? "Hide Output" : "Show Output"}
          </button>
          {showOutput && (
            <div class="task-output">
              <pre>{truncate(task.output, 2000)}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function truncate(str: string, max: number): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

export function StatePanel({ state }: Props) {
  if (!state) {
    return (
      <div class="state-panel-full">
        <div class="state-panel-header">
          <h3>Research State</h3>
        </div>
        <div class="state-panel-empty">
          <p>Waiting for research to begin...</p>
        </div>
      </div>
    );
  }

  const plan = state.plan || [];
  const discoveries = state.discoveries || [];
  const insights = state.keyInsights || [];
  const nextSteps = state.suggestedNextSteps || [];

  return (
    <div class="state-panel-full">
      <div class="state-panel-header">
        <h3>Research State</h3>
        {state.conversationTitle && (
          <span class="state-title">{state.conversationTitle}</span>
        )}
      </div>

      <div class="state-panel-content">
        {/* Current Plan - Always visible if exists */}
        {plan.length > 0 && (
          <CollapsibleSection title="Current Plan" count={plan.length} defaultOpen={true}>
            <div class="plan-tasks">
              {plan.map((task, idx) => (
                <PlanTaskItem key={task.id || idx} task={task} />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Current Objective */}
        {state.currentObjective && (
          <CollapsibleSection title="Current Objective" defaultOpen={true}>
            <p class="objective-text">{state.currentObjective}</p>
          </CollapsibleSection>
        )}

        {/* Working Hypothesis */}
        {state.currentHypothesis && (
          <CollapsibleSection title="Working Hypothesis" defaultOpen={true}>
            <p class="hypothesis-text">{state.currentHypothesis}</p>
          </CollapsibleSection>
        )}

        {/* Key Insights */}
        {insights.length > 0 && (
          <CollapsibleSection title="Key Insights" count={insights.length}>
            <ul class="insights-list">
              {insights.map((insight, idx) => (
                <li key={idx}>{insight}</li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* Discoveries */}
        {discoveries.length > 0 && (
          <CollapsibleSection title="Discoveries" count={discoveries.length}>
            <div class="discoveries-list">
              {discoveries.map((disc, idx) => (
                <div key={idx} class="discovery-item">
                  <div class="discovery-header">{disc.title}</div>
                  <div class="discovery-claim">{disc.claim}</div>
                  {disc.summary && (
                    <div class="discovery-summary">{truncate(disc.summary, 300)}</div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Suggested Next Steps */}
        {nextSteps.length > 0 && (
          <CollapsibleSection title="Suggested Next Steps" count={nextSteps.length}>
            <ul class="next-steps-list">
              {nextSteps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* Methodology */}
        {state.methodology && (
          <CollapsibleSection title="Methodology">
            <p class="methodology-text">{state.methodology}</p>
          </CollapsibleSection>
        )}

        {/* Raw State (Debug) */}
        <CollapsibleSection title="Raw State (Debug)">
          <JsonViewer data={state} maxHeight="300px" />
        </CollapsibleSection>
      </div>
    </div>
  );
}
