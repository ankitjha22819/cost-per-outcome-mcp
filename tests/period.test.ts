import { describe, expect, it } from "vitest";
import { inferPeriodDays, monthly, resolvePeriodDays } from "../src/analysis/period.js";
import { makeRow } from "./helpers.js";

const rows = [
  makeRow({ feature: "summarize", ts: "2026-09-01T00:00:00Z" }),
  makeRow({ feature: "classify", ts: "2026-09-16T00:00:00Z" }),
];

describe("period", () => {
  it("infers the span between first and last call in days", () => expect(inferPeriodDays(rows)).toBe(15));
  it("never returns less than 1 day", () => expect(inferPeriodDays([rows[0]!])).toBe(1));
  it("returns 1 for no calls", () => expect(inferPeriodDays([])).toBe(1));

  it("ignores feature/model filters but honours from/to (D8)", () => {
    expect(resolvePeriodDays(rows, { feature: "summarize" })).toBe(15);
    expect(resolvePeriodDays(rows, { to: "2026-09-02" })).toBe(1);
  });

  it("uses an explicit override", () => expect(resolvePeriodDays(rows, {}, 30)).toBe(30));
  it("scales cost to a 30-day month", () => expect(monthly(6, 15)).toBe(12));
});
