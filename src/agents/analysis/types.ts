export type Dataset = {
  filename: string;
  id: string;
  description: string;
  content?: Buffer;
  path?: string; // Full S3 path when available
};

export type AnalysisResult = {
  objective: string;
  output: string;
  jobId?: string; // Edison task_id or Bio task id
  start?: string;
  end?: string;
  artifacts?: Array<import("../../types/core").AnalysisArtifact>;
};
