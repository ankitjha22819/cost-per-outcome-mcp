import type { CallStatus, Outcome, RowError, TraceRow } from "../types.js";

export type ValidateResult = { ok: true; row: TraceRow } | { ok: false; error: RowError };

const STATUSES: readonly string[] = ["ok", "error", "timeout"];
const OUTCOMES: readonly string[] = ["success", "failure"];
const REQUIRED_STRINGS = ["ts", "request_id", "feature", "model", "status"] as const;
const INT_KEYS = ["input_tokens", "output_tokens", "cached_input_tokens", "attempt", "latency_ms"] as const;
const REQUIRED_INTS: readonly string[] = ["input_tokens", "output_tokens"];
const FLOAT_KEYS = ["retrieval_cost_usd", "cost_usd"] as const;

type IntKey = (typeof INT_KEYS)[number];
type FloatKey = (typeof FLOAT_KEYS)[number];

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** undefined = missing, NaN = present but not a finite number. */
function toNumber(v: unknown): number | undefined {
  if (isMissing(v)) return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

export function validateRow(raw: Record<string, unknown>, line: number): ValidateResult {
  const fail = (message: string): ValidateResult => ({ ok: false, error: { line, message } });

  for (const key of REQUIRED_STRINGS) {
    if (isMissing(raw[key])) return fail(`missing required field "${key}"`);
  }

  const ts = String(raw.ts);
  const tsMs = Date.parse(ts);
  if (Number.isNaN(tsMs)) return fail(`invalid ts "${ts}"`);

  const status = String(raw.status);
  if (!STATUSES.includes(status)) return fail(`invalid status "${status}" (expected ok | error | timeout)`);

  let outcome: Outcome | undefined;
  if (!isMissing(raw.outcome)) {
    const o = String(raw.outcome);
    if (!OUTCOMES.includes(o)) return fail(`invalid outcome "${o}" (expected success | failure)`);
    outcome = o as Outcome;
  }

  const ints: Partial<Record<IntKey, number>> = {};
  for (const key of INT_KEYS) {
    const n = toNumber(raw[key]);
    if (n === undefined) {
      if (REQUIRED_INTS.includes(key)) return fail(`missing required field "${key}"`);
      continue;
    }
    if (!Number.isInteger(n) || n < 0) return fail(`"${key}" must be a non-negative integer`);
    ints[key] = n;
  }
  const inputTokens = ints.input_tokens as number;
  if (ints.attempt !== undefined && ints.attempt < 1) return fail(`"attempt" must be >= 1`);
  if (ints.cached_input_tokens !== undefined && ints.cached_input_tokens > inputTokens) {
    return fail(`"cached_input_tokens" cannot exceed "input_tokens"`);
  }

  const floats: Partial<Record<FloatKey, number>> = {};
  for (const key of FLOAT_KEYS) {
    const n = toNumber(raw[key]);
    if (n === undefined) continue;
    if (Number.isNaN(n) || n < 0) return fail(`"${key}" must be a non-negative number`);
    floats[key] = n;
  }

  return {
    ok: true,
    row: {
      ts,
      tsMs,
      request_id: String(raw.request_id),
      feature: String(raw.feature),
      model: String(raw.model),
      input_tokens: inputTokens,
      output_tokens: ints.output_tokens as number,
      cached_input_tokens: ints.cached_input_tokens,
      attempt: ints.attempt,
      status: status as CallStatus,
      outcome,
      retrieval_cost_usd: floats.retrieval_cost_usd,
      cost_usd: floats.cost_usd,
      latency_ms: ints.latency_ms,
      line,
    },
  };
}
