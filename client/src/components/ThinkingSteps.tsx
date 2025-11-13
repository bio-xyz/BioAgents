import { useState } from "preact/hooks";
import { StateValues } from "../hooks/useStates";
import { Icon } from "./icons";

interface ThinkingStepsProps {
  state: StateValues | null;
}

export function ThinkingSteps({ state }: ThinkingStepsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  if (!state || !state.steps) {
    return null;
  }

  const steps = Object.entries(state.steps);

  // Toggle step expansion
  const toggleStep = (stepName: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepName)) {
      newExpanded.delete(stepName);
    } else {
      newExpanded.add(stepName);
    }
    setExpandedSteps(newExpanded);
  };

  // Get content for each step type
  const getStepContent = (toolName: string): string | null => {
    const upperTool = toolName.toUpperCase();

    // Planning steps
    if (upperTool.startsWith("PLANNING")) {
      return "Planning completed";
    }

    // Knowledge
    if (upperTool === "KNOWLEDGE") {
      const knowledge = (state as any).knowledge;
      if (knowledge && Array.isArray(knowledge) && knowledge.length > 0) {
        return knowledge
          .map((k: any) => `${k.title}: ${k.content}`)
          .join("\n\n");
      }
      return "No knowledge retrieved";
    }

    // OpenScholar
    if (upperTool === "OPENSCHOLAR") {
      const papers = (state as any).openScholarPapers;
      if (papers && Array.isArray(papers) && papers.length > 0) {
        return papers.map((p: any) => `${p.title} (${p.doi})`).join("\n");
      }
      return "No papers found";
    }

    // Semantic Scholar
    if (upperTool === "SEMANTIC_SCHOLAR") {
      const synthesis = (state as any).semanticScholarSynthesis;
      return synthesis || "No synthesis available";
    }

    // Reply
    if (upperTool === "REPLY") {
      ("Generated response.");
    }

    // Reflection
    if (upperTool === "REFLECTION") {
      return "Reflected on the conversation and updated world state successfully";
    }

    // Hypothesis
    if (upperTool.startsWith("HYPOTHESIS")) {
      const hypothesis = (state as any).hypothesis;
      return hypothesis || "Generating hypothesis...";
    }

    // Edison tasks
    if (upperTool.startsWith("EDISON_")) {
      const jobType = upperTool.replace("EDISON_", "");
      const results = (state as any).edisonResults;
      if (results && Array.isArray(results)) {
        // Find the LAST result of this job type
        const matchingResults = results.filter(
          (r: any) => r.jobType === jobType,
        );
        if (matchingResults.length > 0) {
          const lastResult = matchingResults[matchingResults.length - 1];
          return lastResult.answer || lastResult.error || "Processing...";
        }
      }
      return "Processing Edison task...";
    }

    return null;
  };

  // Calculate total duration
  const getDuration = (start: number, end: number) => {
    const durationMs = end - start;
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    }
    return `${(durationMs / 1000).toFixed(2)}s`;
  };

  // Format tool name to be more readable
  const formatToolName = (name: string) => {
    return name
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ");
  };

  // Get icon for each tool
  const getToolIcon = (toolName: string) => {
    // Check for Edison tasks (all use zap icon)
    if (toolName.startsWith("EDISON_")) {
      return "zap";
    }

    // Check for Hypothesis tasks (all use lightbulb icon)
    if (toolName.startsWith("HYPOTHESIS")) {
      return "lightbulb";
    }

    const icons: Record<string, string> = {
      PLANNING: "target",
      PLANNING_DEEP_RESEARCH: "target",
      KNOWLEDGE: "bookOpen",
      OPENSCHOLAR: "graduationCap",
      SEMANTIC_SCHOLAR: "graduationCap",
      REPLY: "messageSquare",
      REFLECTION: "brainCircuit",
      SEARCH: "search",
      ANALYSIS: "barChart",
      SYNTHESIS: "gitMerge",
    };
    return icons[toolName] || "settings";
  };

  // Check if step is complete
  const isStepComplete = (end?: number) => {
    return end !== undefined && end > 0;
  };

  // Count completed and in-progress steps
  const completedCount = steps.filter(([_, s]) => isStepComplete(s.end)).length;
  const inProgressCount = steps.length - completedCount;

  // Calculate total time for completed steps
  const totalTime = steps.reduce((acc, [_, s]) => {
    if (isStepComplete(s.end)) {
      return acc + (s.end! - s.start);
    }
    return acc;
  }, 0);

  const formatTotalTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="thinking-steps">
      <button
        className="thinking-steps-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <div className="thinking-steps-header-left">
          <span className="thinking-steps-icon">
            <Icon name="brainCircuit" size={16} />
          </span>
          <span className="thinking-steps-title">Agent Thinking</span>
          {state.source && (
            <span className="thinking-steps-source">{state.source}</span>
          )}
        </div>
        <div className="thinking-steps-header-right">
          <div className="thinking-steps-summary">
            {inProgressCount > 0 && (
              <span className="thinking-steps-badge in-progress">
                {inProgressCount} running
              </span>
            )}
            {completedCount > 0 && (
              <span className="thinking-steps-badge complete">
                {completedCount} complete
              </span>
            )}
            {totalTime > 0 && (
              <span className="thinking-steps-time">
                {formatTotalTime(totalTime)}
              </span>
            )}
          </div>
          <svg
            className={`thinking-steps-chevron ${isExpanded ? "expanded" : ""}`}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <>
          {state.thought && (
            <div className="thinking-steps-thought">{state.thought}</div>
          )}

          <div className="thinking-steps-list">
            {steps.map(([toolName, toolState]) => {
              const isComplete = isStepComplete(toolState.end);
              const duration = isComplete
                ? getDuration(toolState.start, toolState.end)
                : "In progress...";
              const stepContent = isComplete ? getStepContent(toolName) : null;
              const isStepExpanded = expandedSteps.has(toolName);

              return (
                <div
                  key={toolName}
                  className={`thinking-step ${isComplete ? "complete" : "in-progress"}`}
                >
                  <div
                    className="thinking-step-header"
                    onClick={() =>
                      isComplete && stepContent && toggleStep(toolName)
                    }
                    style={{
                      cursor: isComplete && stepContent ? "pointer" : "default",
                    }}
                  >
                    <div className="thinking-step-icon">
                      <Icon name={getToolIcon(toolName)} size={16} />
                    </div>
                    <div className="thinking-step-content">
                      <div className="thinking-step-name">
                        {formatToolName(toolName)}
                      </div>
                      <div className="thinking-step-duration">{duration}</div>
                    </div>
                    <div className="thinking-step-status">
                      {isComplete ? (
                        <>
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                          >
                            <circle
                              cx="8"
                              cy="8"
                              r="7"
                              fill="#10b981"
                              opacity="0.2"
                            />
                            <path
                              d="M5 8l2 2 4-4"
                              stroke="#10b981"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          {stepContent && (
                            <svg
                              className={`thinking-step-chevron ${isStepExpanded ? "expanded" : ""}`}
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              style={{ marginLeft: "4px" }}
                            >
                              <path
                                d="M4 6l4 4 4-4"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </>
                      ) : (
                        <div className="thinking-step-spinner" />
                      )}
                    </div>
                  </div>
                  {isStepExpanded && stepContent && (
                    <div className="thinking-step-details">{stepContent}</div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
