import { describe, expect, it } from "vitest";
import { validateRow } from "../src/load/validate.js";

const base = {
  ts: "2026-09-14T10:02:11Z",
  request_id: "r_8812",
  feature: "summarize",
  model: "model-large",
  input_tokens: 6120,
  output_tokens: 410,
  status: "timeout",
  attempt: 1,
};

describe("validateRow", () => {
  it("accepts a valid JSON row", () => {
    const r = validateRow(base, 3);
    expect(r).toEqual({
      ok: true,
      row: { ...base, tsMs: Date.parse(base.ts), line: 3 },
    });
  });

  it("coerces CSV strings and treats empty cells as missing", () => {
    const r = validateRow(
      {
        ts: "2026-09-14T10:02:44Z", request_id: "r_8812", feature: "summarize", model: "model-large",
        input_tokens: "6120", output_tokens: "388", cached_input_tokens: "", attempt: "2",
        status: "ok", outcome: "success", retrieval_cost_usd: "0.0004", cost_usd: "", latency_ms: "",
      },
      2,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.input_tokens).toBe(6120);
    expect(r.row.attempt).toBe(2);
    expect(r.row.retrieval_cost_usd).toBeCloseTo(0.0004);
    expect(r.row.cached_input_tokens).toBeUndefined();
    expect(r.row.cost_usd).toBeUndefined();
  });

  it.each([
    [{ ...base, feature: undefined }, 'missing required field "feature"'],
    [{ ...base, input_tokens: "" }, 'missing required field "input_tokens"'],
    [{ ...base, ts: "yesterday" }, 'invalid ts "yesterday"'],
    [{ ...base, status: "200" }, 'invalid status "200"'],
    [{ ...base, outcome: "meh" }, 'invalid outcome "meh"'],
    [{ ...base, output_tokens: -1 }, '"output_tokens" must be a non-negative integer'],
    [{ ...base, input_tokens: 1.5 }, '"input_tokens" must be a non-negative integer'],
    [{ ...base, attempt: 0 }, '"attempt" must be >= 1'],
    [{ ...base, cached_input_tokens: 9999 }, '"cached_input_tokens" cannot exceed "input_tokens"'],
    [{ ...base, cost_usd: "abc" }, '"cost_usd" must be a non-negative number'],
  ])("rejects %o", (raw, message) => {
    const r = validateRow(raw as Record<string, unknown>, 7);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.line).toBe(7);
    expect(r.error.message).toContain(message);
  });
});
