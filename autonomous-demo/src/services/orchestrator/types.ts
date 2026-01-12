// Types for the orchestrator service

export interface ResearchTopic {
  title: string;
  researchQuestion: string;
  background: string;
  suggestedApproaches?: string[];
}

export interface TopicGeneratorResponse {
  topics: ResearchTopic[];
}

export type OrchestratorDecision = "CONTINUE" | "REDIRECT" | "CONCLUDE";

export interface OrchestratorEvaluation {
  decision: OrchestratorDecision;
  reasoning: string;
  steeringMessage: string;
  confidence: "high" | "medium" | "low";
  completionMetrics?: {
    discoveriesCount: number;
    insightsCount: number;
    iterationsCompleted: number;
    hypothesisStrength: "strong" | "moderate" | "weak";
  };
}

export interface ConversationStateValues {
  objective: string;
  conversationTitle?: string;
  currentObjective?: string;
  currentLevel?: number;
  keyInsights?: string[];
  methodology?: string;
  currentHypothesis?: string;
  discoveries?: Discovery[];
  plan?: PlanTask[];
  suggestedNextSteps?: PlanTask[];
}

export interface PlanTask {
  id?: string;
  jobId?: string;
  objective: string;
  datasets: Array<{ filename: string; id: string; description: string }>;
  type: "LITERATURE" | "ANALYSIS";
  level?: number;
  start?: string;
  end?: string;
  output?: string;
  artifacts?: AnalysisArtifact[];
}

export interface AnalysisArtifact {
  id: string;
  description: string;
  type: "FILE" | "FOLDER";
  content?: string;
  name: string;
  path?: string;
}

export interface DiscoveryEvidence {
  taskId: string;
  jobId?: string;
  explanation: string;
}

export interface Discovery {
  title: string;
  claim: string;
  summary: string;
  evidenceArray: DiscoveryEvidence[];
  artifacts: AnalysisArtifact[];
  novelty: string;
}

export type SessionStatus = "active" | "archiving" | "archived" | "failed";

export interface DemoSession {
  id: string;
  conversationId: string;
  topic: ResearchTopic;
  status: SessionStatus;
  currentIteration: number;
  orchestratorDecisions: OrchestratorEvaluation[];
  finalState?: ConversationStateValues;
  paperId?: string;
  paperUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

export interface DemoMessage {
  id: string;
  sessionId: string;
  role: "orchestrator" | "main_server";
  content: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}
