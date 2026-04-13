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
  planning: "Planning research",
  literature: "Researching literature",
  analysis: "Analyzing data",
  reflection: "Synthesizing findings",
  next_steps: "Planning next step",
  reply: "Drafting response",
};

function buildDeepResearchActivity({
  phase,
  objective,
  level,
  taskType,
}: BuildDeepResearchActivityParams): DeepResearchActivity {
  return {
    phase,
    label: ACTIVITY_LABELS[phase],
    objective: normalizeDeepResearchObjective(objective),
    level,
    taskType,
    updatedAt: new Date().toISOString(),
  };
}

export function setDeepResearchActivity(
  values: ConversationStateValues,
  params: BuildDeepResearchActivityParams,
): DeepResearchActivity {
  const activity = buildDeepResearchActivity(params);
  values.currentActivity = activity;
  return activity;
}

export function clearDeepResearchActivity(
  values: ConversationStateValues,
): void {
  delete values.currentActivity;
}
