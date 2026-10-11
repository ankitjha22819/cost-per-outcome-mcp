import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { annotateAttempts, buildDataset } from "../src/dataset.js";
import { loadTrace } from "../src/load/loadTrace.js";
import { loadPricing, priceCall } from "../src/pricing.js";
import { makeRow } from "./helpers.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const pricing = loadPricing(fixture("pricing.json"));
const priced = (...rows: ReturnType<typeof makeRow>[]) => rows.map((r) => priceCall(r, pricing));

describe("annotateAttempts", () => {
  it("numbers attempts by timestamp within a request, keeping input order", () => {
    const out = annotateAttempts(
      priced(
        makeRow({ request_id: "a", ts: "2026-09-01T00:00:10Z", line: 1 }),
        makeRow({ request_id: "a", ts: "2026-09-01T00:00:00Z", line: 2 }),
        makeRow({ request_id: "b", ts: "2026-09-01T00:00:05Z", line: 3 }),
      ),
    );
    expect(out.map((c) => [c.line, c.attemptN])).toEqual([[1, 2], [2, 1], [3, 1]]);
  });

  it("uses file order to break timestamp ties", () => {
    const out = annotateAttempts(priced(makeRow({ request_id: "a", line: 1 }), makeRow({ request_id: "a", line: 2 })));
    expect(out.map((c) => c.attemptN)).toEqual([1, 2]);
  });

  it("keeps an explicit attempt field", () => {
    const out = annotateAttempts(priced(makeRow({ request_id: "a", attempt: 3 })));
    expect(out[0]?.attemptN).toBe(3);
  });
});

describe("buildDataset", () => {
  it("prices and numbers the mini fixture", () => {
    const ds = buildDataset(loadTrace(fixture("mini.jsonl")), pricing);
    expect(ds.calls).toHaveLength(8);
    expect(ds.calls.filter((c) => c.request_id === "r4").map((c) => c.attemptN)).toEqual([1, 2]);
    expect(ds.calls.find((c) => c.request_id === "c1")?.totalCostUsd).toBeCloseTo(4.5, 10);
    expect(ds.calls.find((c) => c.request_id === "c2")?.priced).toBe(false);
    expect(ds.skippedRows).toEqual([]);
    expect(ds.traceSource).toBe(fixture("mini.jsonl"));
  });
});
