import type { AttemptedCall } from "../src/dataset.js";
import type { TraceRow } from "../src/types.js";

export function makeRow(overrides: Partial<TraceRow> = {}): TraceRow {
  const ts = overrides.ts ?? "2026-09-01T00:00:00Z";
  return {
    ts,
    tsMs: Date.parse(ts),
    request_id: "r1",
    feature: "summarize",
    model: "model-large",
    input_tokens: 1000,
    output_tokens: 100,
    status: "ok",
    line: 1,
    ...overrides,
  };
}

/** A priced, attempt-numbered call. totalCostUsd defaults to $1, all of it token cost. */
export function makeCall(overrides: Partial<AttemptedCall> = {}): AttemptedCall {
  const cost = overrides.totalCostUsd ?? 1;
  return {
    ...makeRow(overrides),
    tokenCostUsd: cost,
    retrievalCostUsd: 0,
    totalCostUsd: cost,
    priced: true,
    attemptN: 1,
    ...overrides,
  };
}
