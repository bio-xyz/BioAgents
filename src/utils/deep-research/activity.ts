import type {
  ConversationStateValues,
  DeepResearchActivity,
  DeepResearchActivityPhase,
  PlanTaskType,
} from "../../types/core";
import { normalizeDeepResearchObjective } from "./objective-trace";

type BuildDeepResearchActivityParams = {
  phase: DeepResearchActivityPhase;
  objective?: string;
  level?: number;
  taskType?: PlanTaskType;
};

const ACTIVITY_LABELS: Record<DeepResearchActivityPhase, string> = {
  analysis: "Analyzing data",
  literature: "Researching literature",
  next_steps: "Planning next step",
  planning: "Planning research",
  reflection: "Synthesizing findings",
  reply: "Drafting response",
};

function buildDeepResearchActivity({
  phase,
  objective,
  level,
  taskType,
}: BuildDeepResearchActivityParams): DeepResearchActivity {
  return {
    label: ACTIVITY_LABELS[phase],
    level,
    objective: normalizeDeepResearchObjective(objective),
    phase,
    taskType,
    updatedAt: new Date().toISOString(),
  };
}

export function setDeepResearchActivity(
  values: ConversationStateValues,
  params: BuildDeepResearchActivityParams
): DeepResearchActivity {
  const activity = buildDeepResearchActivity(params);
  values.currentActivity = activity;
  return activity;
}

export function clearDeepResearchActivity(values: ConversationStateValues): void {
  delete values.currentActivity;
}
