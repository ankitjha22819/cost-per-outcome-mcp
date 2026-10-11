import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSample } from "../scripts/sample.js";
import { costPerOutcome } from "../src/analysis/costPerOutcome.js";
import { groupRequests } from "../src/analysis/requests.js";
import { buildDataset } from "../src/dataset.js";
import { loadTrace } from "../src/load/loadTrace.js";
import { validateRow } from "../src/load/validate.js";
import { loadPricing } from "../src/pricing.js";

const dataFile = (name: string) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const rows = generateSample(42);

describe("generateSample", () => {
  it("is deterministic for a seed", () => {
    expect(generateSample(42)).toEqual(rows);
    expect(generateSample(7)).not.toEqual(rows);
  });

  it("has ~500 calls across 4 features and 3 models", () => {
    expect(rows.length).toBeGreaterThanOrEqual(450);
    expect(rows.length).toBeLessThanOrEqual(560);
    expect(new Set(rows.map((r) => r.feature)).size).toBe(4);
    expect(new Set(rows.map((r) => r.model)).size).toBe(3);
  });

  it("produces only schema-valid rows", () => {
    rows.forEach((r, i) => expect(validateRow({ ...r }, i + 1).ok).toBe(true));
  });

  it("exercises retries, timeouts, failures, caching, retrieval and missing outcomes", () => {
    expect(rows.some((r) => r.attempt > 1)).toBe(true);
    expect(rows.some((r) => r.status === "timeout")).toBe(true);
    expect(rows.some((r) => r.outcome === "failure")).toBe(true);
    expect(rows.some((r) => (r.cached_input_tokens ?? 0) > 0)).toBe(true);
    expect(rows.some((r) => (r.retrieval_cost_usd ?? 0) > 0)).toBe(true);
    const finals = rows.filter((r) => r.status === "ok" || r.attempt === 3);
    expect(finals.some((r) => r.outcome === undefined)).toBe(true);
  });

  it("is committed: data/sample-traces.jsonl equals generateSample(42)", () => {
    const committed = readFileSync(dataFile("sample-traces.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(committed).toEqual(JSON.parse(JSON.stringify(rows)));
  });

  it("tells a realistic story: success overhead between 3% and 50%", () => {
    const ds = buildDataset(loadTrace(dataFile("sample-traces.jsonl")), loadPricing(dataFile("pricing.json")));
    const r = costPerOutcome(groupRequests(ds.calls));
    expect(r.unpricedCalls).toBe(0);
    expect(r.overheadPct).toBeGreaterThan(0.03);
    expect(r.overheadPct).toBeLessThan(0.5);
  });
});
