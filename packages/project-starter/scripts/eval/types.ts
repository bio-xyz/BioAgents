export interface EvaluationRecord {
  id: string;
  message_id: string;
  channel_id: string;
  agent_id: string;
  sender_id: string;
  question: string;
  answer: string;
  knowledge_chunks: any[];
  knowledge_graph_chunks: any[];
  knowledge_graph_synthesis: string | null;
  response_time_ms: number;
  created_at: string;
  updated_at: string;
}

export interface ScoredEvaluation extends EvaluationRecord {
  factual_accuracy: number | null; // Human expert rating (initially null)
  completeness: number;
  relevance: number;
  tool_efficiency: number;
  safety_ethics: number; // Binary: 1 or 0
  evidence_synthesis_quality: number;
  hallucinations: number;
  character_adherence: number;
}

export interface Question {
  question: string;
  expectedTools: ('knowledge' | 'knowledge_graph')[];
}

export interface AverageScores {
  avg_completeness: string;
  avg_relevance: string;
  avg_tool_efficiency: string;
  avg_safety_ethics: string;
  avg_evidence_synthesis_quality: string;
  avg_hallucinations: string;
  avg_character_adherence: string;
  avg_response_time_ms: string;
  answered_questions_count: number;
  total_questions_count: number;
}

export enum SOCKET_MESSAGE_TYPE {
  ROOM_JOINING = 1,
  SEND_MESSAGE = 2,
}

export interface SocketMessage {
  type: SOCKET_MESSAGE_TYPE;
  payload: any;
}