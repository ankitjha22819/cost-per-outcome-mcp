import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPricing, PricingLoadError, priceCall, tokenCost } from "../src/pricing.js";
import { makeRow } from "./helpers.js";

const pricing = loadPricing(fileURLToPath(new URL("./fixtures/pricing.json", import.meta.url)));
const large = pricing.models["model-large"]!;

describe("loadPricing", () => {
  it("loads as_of and models", () => {
    expect(pricing.as_of).toBe("2026-10-01");
    expect(Object.keys(pricing.models)).toEqual(["model-large", "model-small"]);
  });

  it("rejects a table with a negative price", () => {
    const dir = mkdtempSync(join(tmpdir(), "cpo-"));
    const path = join(dir, "p.json");
    writeFileSync(path, JSON.stringify({ as_of: "x", models: { m: { input: -1, output: 1 } } }));
    expect(() => loadPricing(path)).toThrow(PricingLoadError);
  });

  it("rejects a missing file", () => {
    expect(() => loadPricing("/nope/pricing.json")).toThrow(PricingLoadError);
  });
});

describe("tokenCost", () => {
  it("prices uncached input + output per 1M tokens", () => {
    // 6120*3 + 410*15 = 24510 → $0.02451
    expect(tokenCost({ input_tokens: 6120, output_tokens: 410 }, large)).toBeCloseTo(0.02451, 10);
  });

  it("bills cached tokens at the cached rate; input_tokens includes cached (D1)", () => {
    // 600*3 + 400*0.3 + 100*15 = 3420 → $0.00342
    expect(tokenCost({ input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100 }, large)).toBeCloseTo(0.00342, 10);
  });

  it("falls back to the input rate when the model has no cached price (D2)", () => {
    expect(tokenCost({ input_tokens: 1000, cached_input_tokens: 400, output_tokens: 0 }, { input: 1, output: 2 })).toBeCloseTo(0.001, 10);
  });
});

describe("priceCall", () => {
  it("adds retrieval cost to token cost", () => {
    const c = priceCall(makeRow({ input_tokens: 6120, output_tokens: 410, retrieval_cost_usd: 0.0004 }), pricing);
    expect(c.priced).toBe(true);
    expect(c.tokenCostUsd).toBeCloseTo(0.02451, 10);
    expect(c.retrievalCostUsd).toBeCloseTo(0.0004, 10);
    expect(c.totalCostUsd).toBeCloseTo(0.02491, 10);
  });

  it("cost_usd overrides token cost but retrieval still adds (D3)", () => {
    const c = priceCall(makeRow({ cost_usd: 1, retrieval_cost_usd: 0.5, model: "unknown-model" }), pricing);
    expect(c).toMatchObject({ tokenCostUsd: 1, retrievalCostUsd: 0.5, totalCostUsd: 1.5, priced: true });
  });

  it("flags unknown models instead of silently pricing them (D11)", () => {
    const c = priceCall(makeRow({ model: "model-mystery", retrieval_cost_usd: 0.1 }), pricing);
    expect(c).toMatchObject({ tokenCostUsd: 0, totalCostUsd: 0.1, priced: false });
  });
});
