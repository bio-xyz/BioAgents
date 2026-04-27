import { useState } from "preact/hooks";
import { Icon } from "../icons";
import { ArtifactViewer } from "./ArtifactViewer";

interface Dataset {
  id: string;
  filename: string;
  description: string;
  size?: number;
}

interface AnalysisArtifact {
  id: string;
  description: string;
  type: "FILE" | "FOLDER";
  content?: string;
  name: string;
  path?: string;
}

interface PlanStep {
  id?: string;
  type: string;
  objective: string;
  output?: string;
  datasets?: Dataset[];
  start?: string;
  end?: string;
  artifacts?: AnalysisArtifact[];
}

interface ResearchState {
  plan?: PlanStep[];
  discoveries?: string[];
  keyInsights?: string[];
  methodology?: string;
  currentObjective?: string;
  uploadedDatasets?: Dataset[];
  currentHypothesis?: string;
}

interface Props {
  state: ResearchState | null;
  isExpanded?: boolean;
  onToggle?: () => void;
  isLoading?: boolean;
}

export function ResearchStatePanel({
  state,
  isExpanded = false,
  onToggle,
  isLoading = false,
}: Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    datasets: false,
    discoveries: false,
    hypothesis: true,
    insights: false,
    methodology: false,
    plan: false,
  });

  // Track which step outputs are expanded
  const [expandedStepOutputs, setExpandedStepOutputs] = useState<Record<string, boolean>>({});

  const toggleStepOutput = (stepKey: string) => {
    setExpandedStepOutputs((prev) => ({
      ...prev,
      [stepKey]: !prev[stepKey],
    }));
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const formatStepType = (type: string) => {
    const types: Record<string, { label: string; icon: string; color: string }> = {
      ANALYSIS: { color: "#06b6d4", icon: "📊", label: "Data Analysis" },
      HYPOTHESIS: { color: "#f59e0b", icon: "💡", label: "Hypothesis" },
      LITERATURE: { color: "#8b5cf6", icon: "📚", label: "Literature Search" },
      PLANNING: { color: "#3b82f6", icon: "📋", label: "Planning" },
      REFLECTION: { color: "#10b981", icon: "🔍", label: "Reflection" },
    };
    return types[type] || { color: "#6b7280", icon: "⚡", label: type };
  };

  const parseCitationText = (text: string) => {
    // Parse citations like [text](url) into clickable links
    const parts = [];
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          content: text.slice(lastIndex, match.index),
          key: `text-${lastIndex}`,
          type: "text",
        });
      }
      parts.push({
        key: `link-${match.index}-${match[2]}`,
        text: match[1],
        type: "link",
        url: match[2],
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({
        content: text.slice(lastIndex),
        key: `text-${lastIndex}`,
        type: "text",
      });
    }

    return parts;
  };

  const renderCitationText = (text: string) => {
    const parts = parseCitationText(text);
    return parts.map((part) =>
      part.type === "link" ? (
        <a
          key={part.key}
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          className="research-citation-link"
        >
          {part.text}
        </a>
      ) : (
        <span key={part.key}>{part.content}</span>
      )
    );
  };

  const completedSteps = state?.plan?.filter((step) => step.end) || [];
  const currentStep = state?.plan?.find((step) => step.start && !step.end);

  const getStepKey = (step: PlanStep) =>
    step.id || `${step.type}-${step.objective}-${step.start || ""}-${step.end || ""}`;

  const hypothesisLines = (() => {
    const lines = state?.currentHypothesis?.split("\n") || [];
    let offset = 0;
    return lines.map((line) => {
      const key = `${offset}-${line}`;
      offset += line.length + 1;
      return { key, line };
    });
  })();

  // Show loading state when deep research is starting but no state yet
  const showLoadingState = isLoading && (!state || !state.currentObjective);

  return (
    <div className={`research-state-panel ${isExpanded ? "expanded" : ""}`}>
      <button className="research-state-header" onClick={onToggle}>
        <div className="research-state-header-left">
          <span className="research-state-icon">🧬</span>
          <span className="research-state-title">Research State</span>
        </div>
        <div className="research-state-header-right">
          <Icon
            name="chevronDown"
            size={16}
            className={`research-state-chevron ${isExpanded ? "expanded" : ""}`}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="research-state-content">
          {/* Loading State */}
          {showLoadingState && (
            <div className="research-section research-loading-state">
              <div className="research-loading-indicator">
                <span className="research-step-spinner" />
                <span className="research-loading-text">Initializing deep research...</span>
              </div>
            </div>
          )}

          {/* Current Objective */}
          {state?.currentObjective && (
            <div className="research-section research-current-objective">
              <div className="research-section-label">
                <span className="research-section-icon">🎯</span>
                Current Objective
              </div>
              <p className="research-objective-text">{state?.currentObjective}</p>
            </div>
          )}

          {/* Hypothesis */}
          {state?.currentHypothesis && (
            <div className="research-section">
              <button
                className="research-section-toggle"
                onClick={() => toggleSection("hypothesis")}
              >
                <div className="research-section-toggle-left">
                  <span className="research-section-icon">💡</span>
                  <span>Hypothesis</span>
                </div>
                <Icon
                  name="chevronDown"
                  size={14}
                  className={`research-section-chevron ${expandedSections.hypothesis ? "expanded" : ""}`}
                />
              </button>
              {expandedSections.hypothesis && (
                <div className="research-section-body research-hypothesis">
                  <div className="research-hypothesis-content">
                    {hypothesisLines.map(({ key, line }) => {
                      if (line.startsWith("## ")) {
                        return (
                          <h4 key={key} className="research-hypothesis-heading">
                            {line.replace("## ", "")}
                          </h4>
                        );
                      }
                      if (line.trim()) {
                        return (
                          <p key={key} className="research-hypothesis-paragraph">
                            {renderCitationText(line)}
                          </p>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Discoveries */}
          {state?.discoveries && state.discoveries.length > 0 && (
            <div className="research-section">
              <button
                className="research-section-toggle"
                onClick={() => toggleSection("discoveries")}
              >
                <div className="research-section-toggle-left">
                  <span className="research-section-icon">🔬</span>
                  <span>Discoveries ({state.discoveries.length})</span>
                </div>
                <Icon
                  name="chevronDown"
                  size={14}
                  className={`research-section-chevron ${expandedSections.discoveries ? "expanded" : ""}`}
                />
              </button>
              {expandedSections.discoveries && (
                <div className="research-section-body">
                  <ul className="research-discoveries-list">
                    {state.discoveries.map((discovery) => (
                      <li key={discovery} className="research-discovery-item">
                        {renderCitationText(discovery)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Key Insights */}
          {state?.keyInsights && state.keyInsights.length > 0 && (
            <div className="research-section">
              <button className="research-section-toggle" onClick={() => toggleSection("insights")}>
                <div className="research-section-toggle-left">
                  <span className="research-section-icon">✨</span>
                  <span>Key Insights ({state.keyInsights.length})</span>
                </div>
                <Icon
                  name="chevronDown"
                  size={14}
                  className={`research-section-chevron ${expandedSections.insights ? "expanded" : ""}`}
                />
              </button>
              {expandedSections.insights && (
                <div className="research-section-body">
                  <ul className="research-insights-list">
                    {state.keyInsights.map((insight) => (
                      <li key={insight} className="research-insight-item">
                        {renderCitationText(insight)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Methodology */}
          {state?.methodology && (
            <div className="research-section">
              <button
                className="research-section-toggle"
                onClick={() => toggleSection("methodology")}
              >
                <div className="research-section-toggle-left">
                  <span className="research-section-icon">🔬</span>
                  <span>Methodology</span>
                </div>
                <Icon
                  name="chevronDown"
                  size={14}
                  className={`research-section-chevron ${expandedSections.methodology ? "expanded" : ""}`}
                />
              </button>
              {expandedSections.methodology && (
                <div className="research-section-body">
                  <p className="research-methodology-text">{state?.methodology}</p>
                </div>
              )}
            </div>
          )}

          {/* Uploaded Datasets */}
          {state?.uploadedDatasets && state.uploadedDatasets.length > 0 && (
            <div className="research-section">
              <button className="research-section-toggle" onClick={() => toggleSection("datasets")}>
                <div className="research-section-toggle-left">
                  <span className="research-section-icon">📁</span>
                  <span>Datasets ({state.uploadedDatasets.length})</span>
                </div>
                <Icon
                  name="chevronDown"
                  size={14}
                  className={`research-section-chevron ${expandedSections.datasets ? "expanded" : ""}`}
                />
              </button>
              {expandedSections.datasets && (
                <div className="research-section-body">
                  <div className="research-datasets-list">
                    {state.uploadedDatasets.map((dataset) => (
                      <div key={dataset.id} className="research-dataset-item">
                        <Icon name="file" size={14} />
                        <div className="research-dataset-info">
                          <span className="research-dataset-name">{dataset.filename}</span>
                          <span className="research-dataset-description">
                            {dataset.description}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Completed Steps */}
          {completedSteps.length > 0 && (
            <div className="research-section">
              <button className="research-section-toggle" onClick={() => toggleSection("plan")}>
                <div className="research-section-toggle-left">
                  <span className="research-section-icon">✅</span>
                  <span>Completed Steps ({completedSteps.length})</span>
                </div>
                <Icon
                  name="chevronDown"
                  size={14}
                  className={`research-section-chevron ${expandedSections.plan ? "expanded" : ""}`}
                />
              </button>
              {expandedSections.plan && (
                <div className="research-section-body">
                  <div className="research-steps-list">
                    {completedSteps.map((step) => {
                      const stepInfo = formatStepType(step.type);
                      const stepKey = getStepKey(step);
                      const isOutputExpanded = expandedStepOutputs[stepKey] || false;
                      const outputPreviewLength = 300;
                      const needsTruncation =
                        step.output && step.output.length > outputPreviewLength;

                      return (
                        <div key={stepKey} className="research-step-item completed">
                          <div className="research-step-header">
                            <div
                              className="research-step-type"
                              style={{
                                background: `${stepInfo.color}15`,
                                color: stepInfo.color,
                              }}
                            >
                              <span className="research-step-emoji">{stepInfo.icon}</span>
                              {stepInfo.label}
                            </div>
                          </div>
                          <p className="research-step-objective">{step.objective}</p>

                          {/* Step datasets */}
                          {step.datasets && step.datasets.length > 0 && (
                            <div className="research-step-datasets">
                              {step.datasets.map((ds) => (
                                <span
                                  key={ds.id || ds.filename}
                                  className="research-step-dataset-badge"
                                >
                                  <Icon name="file" size={12} />
                                  {ds.filename}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Step artifacts */}
                          {step.artifacts && step.artifacts.length > 0 && (
                            <div className="research-step-artifacts" style={{ marginTop: "8px" }}>
                              <ArtifactViewer
                                results={[
                                  {
                                    artifacts: step.artifacts.map((a) => ({
                                      content: a.content || "",
                                      description: a.description,
                                      filename: a.name,
                                      id: a.id,
                                      path: a.path,
                                    })),
                                    success: true,
                                  },
                                ]}
                                defaultExpanded={false}
                              />
                            </div>
                          )}

                          {/* Step output with expand/collapse */}
                          {step.output && (
                            <div className="research-step-output">
                              <pre className="research-step-output-content">
                                {isOutputExpanded
                                  ? step.output
                                  : needsTruncation
                                    ? step.output.slice(0, outputPreviewLength) + "..."
                                    : step.output}
                              </pre>
                              {needsTruncation && (
                                <button
                                  className="research-step-output-toggle"
                                  onClick={() => toggleStepOutput(stepKey)}
                                >
                                  {isOutputExpanded ? (
                                    <>
                                      <Icon name="chevronUp" size={12} />
                                      Show less
                                    </>
                                  ) : (
                                    <>
                                      <Icon name="chevronDown" size={12} />
                                      Show full output ({Math.round(step.output.length / 1000)}k
                                      chars)
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Current Step (if running) */}
          {currentStep && (
            <div className="research-section research-current-step">
              <div className="research-section-label">
                <span className="research-step-spinner" />
                Running: {formatStepType(currentStep.type).label}
              </div>
              <p className="research-step-objective">{currentStep.objective}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
