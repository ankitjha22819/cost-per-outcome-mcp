import { describe, expect, it } from "vitest";
import { costByFeature } from "../src/analysis/costByFeature.js";
import { makeCall } from "./helpers.js";

const calls = [
  // summarize: first attempt with retrieval, then a retry → tokens 1, retrieval 0.5, retries 2
  makeCall({ request_id: "s1", feature: "summarize", model: "model-large", attemptN: 1, tokenCostUsd: 1, retrievalCostUsd: 0.5, totalCostUsd: 1.5 }),
  makeCall({ request_id: "s1", feature: "summarize", model: "model-large", attemptN: 2, tokenCostUsd: 1.5, retrievalCostUsd: 0.5, totalCostUsd: 2 }),
  makeCall({ request_id: "s2", feature: "summarize", model: "model-small", attemptN: 1, totalCostUsd: 0.5 }),
  makeCall({ request_id: "c1", feature: "classify", model: "model-small", attemptN: 1, totalCostUsd: 1 }),
];

describe("costByFeature", () => {
  const r = costByFeature(calls, 15);

  it("sorts features by spend and computes share and monthly", () => {
    expect(r.features.map((f) => f.feature)).toEqual(["summarize", "classify"]);
    expect(r.totalCostUsd).toBe(5);
    expect(r.monthlyTotalUsd).toBe(10);
    expect(r.features[0]).toMatchObject({ calls: 3, requests: 2, total: 4, share: 0.8, monthlyUsd: 8 });
  });

  it("splits cost into non-overlapping layers (D4)", () => {
    expect(r.features[0]).toMatchObject({ tokens: 1.5, retrieval: 0.5, retries: 2, total: 4 });
  });

  it("breaks each feature down by model, sorted by spend", () => {
    expect(r.features[0]?.models.map((m) => [m.model, m.calls, m.total])).toEqual([
      ["model-large", 2, 3.5],
      ["model-small", 1, 0.5],
    ]);
  });
});
