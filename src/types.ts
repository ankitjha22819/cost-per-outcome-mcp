export type CallStatus = "ok" | "error" | "timeout";
export type Outcome = "success" | "failure";

/** One validated LLM call. Field names follow the README trace schema. */
export interface TraceRow {
  ts: string;
  tsMs: number;
  request_id: string;
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  attempt?: number;
  status: CallStatus;
  outcome?: Outcome;
  retrieval_cost_usd?: number;
  cost_usd?: number;
  latency_ms?: number;
  /** 1-based line in the source file, for error messages. */
  line: number;
}

export interface RowError {
  line: number;
  message: string;
}

export interface LoadedTrace {
  rows: TraceRow[];
  errors: RowError[];
  source: string;
}
