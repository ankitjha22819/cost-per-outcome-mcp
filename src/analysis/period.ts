import type { TraceRow } from "../types.js";
import { applyFilters, type Filters } from "./filters.js";

const DAY_MS = 86_400_000;

export function inferPeriodDays(calls: Pick<TraceRow, "tsMs">[]): number {
  if (calls.length === 0) return 1;
  let min = Infinity;
  let max = -Infinity;
  for (const c of calls) {
    if (c.tsMs < min) min = c.tsMs;
    if (c.tsMs > max) max = c.tsMs;
  }
  return Math.max(1, (max - min) / DAY_MS);
}

/** D8: the window is set by from/to only, so a sparse feature isn't over-projected. */
export function resolvePeriodDays(calls: TraceRow[], filters: Filters, override?: number): number {
  return override ?? inferPeriodDays(applyFilters(calls, { from: filters.from, to: filters.to }));
}

export function monthly(costUsd: number, periodDays: number): number {
  return costUsd * (30 / periodDays);
}
