import { describe, expect, it } from "vitest";
import type { CostPerOutcomeResult } from "../src/analysis/costPerOutcome.js";
import type { SwapResult } from "../src/analysis/modelSwapWhatif.js";
import { money, pct, renderCostPerOutcome, renderSwap, signedPct } from "../src/format.js";

const ctx = { scope: "Feature: summarize", periodDays: 15, currency: "USD", notes: ["Pricing as of 2026-10-01."] };

describe("number helpers", () => {
  it("formats money", () => {
    expect(money(4.32, "USD")).toBe("$4.32");
    expect(money(0.024, "USD", 4)).toBe("$0.0240");
    expect(money(0.0012, "USD")).toBe("$0.0012");
    expect(money(-1, "USD")).toBe("-$1.00");
    expect(money(4.32, "EUR")).toBe("4.32 EUR");
  });

  it("formats percentages", () => {
    expect(pct(0.839, 1)).toBe("83.9%");
    expect(pct(0.14)).toBe("14%");
    expect(signedPct(0.19)).toBe("+19%");
    expect(signedPct(-0.05)).toBe("-5%");
  });
});

describe("renderCostPerOutcome", () => {
  const result: CostPerOutcomeResult = {
    requests: 4, calls: 6, retryCalls: 2, successes: 2, successRate: 0.5, totalCostUsd: 6,
    costPerRequestUsd: 1.5, costPerSuccessUsd: 3, overheadPct: 1, retryOverheadUsd: 1, failedRequestsUsd: 2,
    outcomeInferredRequests: 1, unpricedCalls: 0,
  };
  const text = renderCostPerOutcome(result, ctx);

  it("matches the README layout", () => {
    expect(text).toContain("Feature: summarize   (15 days)");
    expect(text).toMatch(/Calls \(incl\. retries\)\s+6\s+\+2 retry calls/);
    expect(text).toMatch(/Cost per success\s+\$3\.0000\s+← \+100% vs per-request/);
    expect(text).toMatch(/Retries\s+\$1\.00\s+17%/);
    expect(text).toMatch(/Failed requests\s+\$2\.00\s+33%/);
  });

  it("explains inferred outcomes and appends notes", () => {
    expect(text).toContain("Note: 1 of 4 requests had no outcome field");
    expect(text).toContain("Note: Pricing as of 2026-10-01.");
  });

  it("handles no successes", () => {
    const none = renderCostPerOutcome({ ...result, successes: 0, costPerSuccessUsd: null, overheadPct: null }, ctx);
    expect(none).toContain("n/a (no successful requests)");
  });
});

describe("renderSwap", () => {
  const swap: SwapResult = {
    feature: "classify", sourceModels: ["model-large"], targetModel: "model-small", calls: 1,
    inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000, currentCostUsd: 4.5,
    projectedCostUsd: 0.375, savingsUsd: 4.125, savingsPct: 0.9167, currentMonthlyUsd: 9,
    projectedMonthlyUsd: 0.75, monthlySavingsUsd: 8.25, periodDays: 15, excludedUnpricedCalls: 1,
    overriddenCostCalls: 0, asOf: "2026-10-01",
  };
  const text = renderSwap(swap, { ...ctx, scope: "Feature: classify", notes: [] });

  it("shows the projection and monthly savings", () => {
    expect(text).toContain("model-large → model-small");
    expect(text).toMatch(/Estimated savings\s+\$4\.13 \(92%\)\s+→ \$8\.25 \/ month/);
    expect(text).toContain("1 calls on unpriced models were left out");
  });

  it("always carries the quality caveat", () => {
    expect(text).toContain("worth testing");
    expect(text).toContain("±10–20%");
  });
});
