import { describe, expect, it } from "vitest";
import { median, topExpensiveCalls } from "../src/analysis/topExpensiveCalls.js";
import { makeCall } from "./helpers.js";

const calls = [
  makeCall({ request_id: "a", totalCostUsd: 5, input_tokens: 4000 }),
  makeCall({ request_id: "b", totalCostUsd: 1, input_tokens: 1000, ts: "2026-09-02T00:00:00Z" }),
  makeCall({ request_id: "c", totalCostUsd: 3, input_tokens: 2000 }),
  makeCall({ request_id: "d", totalCostUsd: 1, input_tokens: 1000, ts: "2026-09-01T00:00:00Z" }),
];

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4000, 1000, 2000, 1000])).toBe(1500);
    expect(median([])).toBe(0);
  });
});

describe("topExpensiveCalls", () => {
  it("returns the N most expensive calls with spend share", () => {
    const r = topExpensiveCalls(calls, 2);
    expect(r.calls.map((e) => e.call.request_id)).toEqual(["a", "c"]);
    expect(r.calls.map((e) => e.share)).toEqual([0.5, 0.3]);
    expect(r.topShare).toBeCloseTo(0.8, 10);
    expect(r).toMatchObject({ totalCostUsd: 10, totalCalls: 4, medianInputTokens: 1500 });
  });

  it("compares input size against the median", () => {
    expect(topExpensiveCalls(calls, 1).calls[0]?.inputVsMedian).toBeCloseTo(4000 / 1500, 10);
  });

  it("breaks ties by earlier timestamp and caps at the number of calls", () => {
    const r = topExpensiveCalls(calls, 99);
    expect(r.calls.map((e) => e.call.request_id)).toEqual(["a", "c", "d", "b"]);
  });
});
