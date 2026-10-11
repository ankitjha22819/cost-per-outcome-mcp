import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { modelSwapWhatif, WhatifError } from "../src/analysis/modelSwapWhatif.js";
import { annotateAttempts } from "../src/dataset.js";
import { loadPricing, priceCall } from "../src/pricing.js";
import { makeRow } from "./helpers.js";

const pricing = loadPricing(fileURLToPath(new URL("./fixtures/pricing.json", import.meta.url)));
const calls = annotateAttempts(
  [
    makeRow({ request_id: "c1", feature: "classify", model: "model-large", input_tokens: 1_000_000, output_tokens: 100_000 }),
    makeRow({ request_id: "c2", feature: "classify", model: "model-mystery", input_tokens: 10, output_tokens: 1 }),
    makeRow({ request_id: "c3", feature: "classify", model: "model-small", input_tokens: 500, output_tokens: 5 }),
    makeRow({ request_id: "s1", feature: "summarize", model: "model-large", input_tokens: 9_999, output_tokens: 999 }),
  ].map((r) => priceCall(r, pricing)),
);
const base = { feature: "classify", targetModel: "model-small", periodDays: 15 };

describe("modelSwapWhatif", () => {
  it("reprices the feature's non-target calls against the target model", () => {
    const r = modelSwapWhatif(calls, pricing, base);
    expect(r).toMatchObject({
      feature: "classify",
      sourceModels: ["model-large"],
      targetModel: "model-small",
      calls: 1,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      excludedUnpricedCalls: 1,
      overriddenCostCalls: 0,
      asOf: "2026-10-01",
    });
    expect(r.currentCostUsd).toBeCloseTo(4.5, 10);
    expect(r.projectedCostUsd).toBeCloseTo(0.375, 10);
    expect(r.savingsUsd).toBeCloseTo(4.125, 10);
    expect(r.savingsPct).toBeCloseTo(4.125 / 4.5, 10);
    expect(r.monthlySavingsUsd).toBeCloseTo(8.25, 10);
  });

  it("restricts to an explicit source model", () => {
    const r = modelSwapWhatif(calls, pricing, { ...base, sourceModel: "model-large" });
    expect(r).toMatchObject({ calls: 1, excludedUnpricedCalls: 0 });
  });

  it.each([
    [{ ...base, targetModel: "model-nope" }, /Unknown target model "model-nope".*model-large, model-small/],
    [{ ...base, feature: "nope" }, /No calls for feature "nope"/],
    [{ ...base, sourceModel: "model-small" }, /Source and target model are the same/],
    [{ ...base, sourceModel: "model-mystery" }, /missing from the pricing table/],
  ])("rejects %o", (input, message) => {
    expect(() => modelSwapWhatif(calls, pricing, input)).toThrow(WhatifError);
    expect(() => modelSwapWhatif(calls, pricing, input)).toThrow(message);
  });
});
