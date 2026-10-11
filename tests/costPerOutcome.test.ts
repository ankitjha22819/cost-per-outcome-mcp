import { describe, expect, it } from "vitest";
import { costPerOutcome } from "../src/analysis/costPerOutcome.js";
import { groupRequests } from "../src/analysis/requests.js";
import { makeCall } from "./helpers.js";

const calls = [
  makeCall({ request_id: "r1", attemptN: 1, status: "timeout", totalCostUsd: 1 }),
  makeCall({ request_id: "r1", attemptN: 2, status: "ok", outcome: "success", totalCostUsd: 1 }),
  makeCall({ request_id: "r2", attemptN: 1, status: "ok", outcome: "success", totalCostUsd: 2 }),
  makeCall({ request_id: "r3", attemptN: 1, status: "ok", outcome: "failure", totalCostUsd: 1 }),
  makeCall({ request_id: "r4", attemptN: 1, status: "error", totalCostUsd: 0.5 }),
  makeCall({ request_id: "r4", attemptN: 2, status: "error", totalCostUsd: 0.5, priced: false }),
];

describe("costPerOutcome", () => {
  it("spreads all spend over successful requests", () => {
    const r = costPerOutcome(groupRequests(calls));
    expect(r).toMatchObject({
      requests: 4,
      calls: 6,
      retryCalls: 2,
      successes: 2,
      successRate: 0.5,
      totalCostUsd: 6,
      costPerRequestUsd: 1.5,
      costPerSuccessUsd: 3,
      overheadPct: 1,
      retryOverheadUsd: 1,
      failedRequestsUsd: 2,
      outcomeInferredRequests: 1,
      unpricedCalls: 1,
    });
  });

  it("returns null cost per success when nothing succeeded", () => {
    const r = costPerOutcome(groupRequests([makeCall({ request_id: "x", status: "error" })]));
    expect(r.costPerSuccessUsd).toBeNull();
    expect(r.overheadPct).toBeNull();
    expect(r.failedRequestsUsd).toBe(1);
  });

  it("handles an empty input without dividing by zero", () => {
    const r = costPerOutcome([]);
    expect(r).toMatchObject({ requests: 0, costPerRequestUsd: 0, successRate: 0, costPerSuccessUsd: null });
  });
});
