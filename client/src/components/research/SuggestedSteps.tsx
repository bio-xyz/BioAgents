import type { JSX } from "preact";
import { Icon } from "../icons";

interface Dataset {
  id: string;
  filename: string;
  description: string;
}

interface SuggestedStep {
  type: string;
  objective: string;
  datasets?: Dataset[];
}

interface Props {
  steps: SuggestedStep[];
  onSelectStep: (step: SuggestedStep, index: number) => void;
  onCustomInput?: () => void;
  disabled?: boolean;
}

export function SuggestedSteps({ steps, onSelectStep, onCustomInput, disabled }: Props) {
  if (!steps || steps.length === 0) return null;

  const getStepConfig = (type: string) => {
    const configs: Record<string, { icon: string; label: string; color: string; bgColor: string }> =
      {
        ANALYSIS: {
          bgColor: "rgba(6, 182, 212, 0.1)",
          color: "#06b6d4",
          icon: "📊",
          label: "Data Analysis",
        },
        CODE_EXEC: {
          bgColor: "rgba(236, 72, 153, 0.1)",
          color: "#ec4899",
          icon: "💻",
          label: "Code Execution",
        },
        HYPOTHESIS: {
          bgColor: "rgba(245, 158, 11, 0.1)",
          color: "#f59e0b",
          icon: "💡",
          label: "Hypothesis Generation",
        },
        LITERATURE: {
          bgColor: "rgba(139, 92, 246, 0.1)",
          color: "#8b5cf6",
          icon: "📚",
          label: "Literature Search",
        },
        PLANNING: {
          bgColor: "rgba(59, 130, 246, 0.1)",
          color: "#3b82f6",
          icon: "📋",
          label: "Planning",
        },
        REFLECTION: {
          bgColor: "rgba(16, 185, 129, 0.1)",
          color: "#10b981",
          icon: "🔍",
          label: "Reflection",
        },
      };
    return (
      configs[type] || {
        bgColor: "rgba(107, 114, 128, 0.1)",
        color: "#6b7280",
        icon: "⚡",
        label: type,
      }
    );
  };

  return (
    <div className="suggested-steps-container">
      <div className="suggested-steps-header">
        <span className="suggested-steps-icon">🚀</span>
        <span className="suggested-steps-title">Suggested Next Steps</span>
        <span className="suggested-steps-hint">Click to proceed</span>
      </div>

      <div className="suggested-steps-list">
        {steps.map((step, index) => {
          const config = getStepConfig(step.type);
          return (
            <button
              key={`${step.type}-${step.objective}`}
              className="suggested-step-card"
              onClick={() => onSelectStep(step, index)}
              disabled={disabled}
              style={
                {
                  "--step-bg": config.bgColor,
                  "--step-color": config.color,
                } as JSX.CSSProperties
              }
            >
              <div className="suggested-step-header">
                <span className="suggested-step-type-badge">
                  <span className="suggested-step-emoji">{config.icon}</span>
                  {config.label}
                </span>
                <Icon name="send" size={14} className="suggested-step-arrow" />
              </div>

              <p className="suggested-step-objective">{step.objective}</p>

              {step.datasets && step.datasets.length > 0 && (
                <div className="suggested-step-datasets">
                  <Icon name="file" size={12} />
                  <span>
                    {step.datasets.length} dataset{step.datasets.length !== 1 ? "s" : ""}:{" "}
                    {step.datasets.map((d) => d.filename).join(", ")}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {onCustomInput && (
        <button className="suggested-steps-custom" onClick={onCustomInput} disabled={disabled}>
          <Icon name="plus" size={14} />
          <span>Or type your own instruction...</span>
        </button>
      )}
    </div>
  );
}
