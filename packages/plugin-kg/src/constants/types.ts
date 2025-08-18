export interface QueryStep {
  step: number;
  type: string;
  inputs: {
    concepts?: string[];
    authors?: string[];
    papers?: string[];
    previous_results?: any;
  };
  depends_on: number[];
}

export interface ExecutionPlan {
  plan: QueryStep[];
}

export interface StepResult {
  step: number;
  type: string;
  tool_used: 'SPARQL' | 'HYPOTHESIS';
  prompt_used: string;
  query_or_response: string;
  data: any;
  processed_output: any;
  paper_count?: number;
  papers?: Array<{ doi: string; title: string; abstract: string }>;
}

export interface SparqlResponse {
  results: {
    bindings: Array<any>;
  };
}
