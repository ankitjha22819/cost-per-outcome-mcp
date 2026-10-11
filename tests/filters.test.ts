import { describe, expect, it } from "vitest";
import { applyFilters, FilterError } from "../src/analysis/filters.js";
import { makeRow } from "./helpers.js";

const rows = [
  makeRow({ request_id: "a", feature: "summarize", model: "model-large", ts: "2026-09-14T00:00:00Z" }),
  makeRow({ request_id: "b", feature: "classify", model: "model-small", ts: "2026-09-14T23:59:59Z" }),
  makeRow({ request_id: "c", feature: "summarize", model: "model-small", ts: "2026-09-15T00:00:00Z" }),
];
const ids = (f: Parameters<typeof applyFilters>[1]) => applyFilters(rows, f).map((r) => r.request_id);

describe("applyFilters", () => {
  it("returns everything with no filters", () => expect(ids({})).toEqual(["a", "b", "c"]));
  it("filters by feature", () => expect(ids({ feature: "summarize" })).toEqual(["a", "c"]));
  it("filters by model", () => expect(ids({ model: "model-small" })).toEqual(["b", "c"]));
  it("treats from as inclusive", () => expect(ids({ from: "2026-09-14T23:59:59Z" })).toEqual(["b", "c"]));
  it("treats a datetime to as exclusive", () => expect(ids({ to: "2026-09-14T23:59:59Z" })).toEqual(["a"]));
  it("treats a date-only to as covering that whole day", () => expect(ids({ to: "2026-09-14" })).toEqual(["a", "b"]));
  it("combines filters", () => expect(ids({ feature: "summarize", from: "2026-09-15" })).toEqual(["c"]));

  it("rejects an invalid date", () => {
    expect(() => ids({ from: "last tuesday" })).toThrow(FilterError);
    expect(() => ids({ from: "last tuesday" })).toThrow(/Invalid "from" date/);
  });

  it("rejects from after to", () => {
    expect(() => ids({ from: "2026-09-20", to: "2026-09-10" })).toThrow(/"from" must be before "to"/);
  });
});
