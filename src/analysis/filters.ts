import type { TraceRow } from "../types.js";

export interface Filters {
  feature?: string;
  model?: string;
  /** Inclusive. ISO 8601 date or datetime. */
  from?: string;
  /** Exclusive. A date-only value covers that whole day. */
  to?: string;
}

export class FilterError extends Error {}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseBound(value: string, name: "from" | "to"): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new FilterError(`Invalid "${name}" date "${value}". Use ISO 8601, e.g. 2026-09-14 or 2026-09-14T10:00:00Z`);
  }
  return name === "to" && DATE_ONLY.test(value) ? ms + DAY_MS : ms;
}

export function applyFilters<T extends TraceRow>(calls: T[], filters: Filters): T[] {
  const fromMs = filters.from ? parseBound(filters.from, "from") : -Infinity;
  const toMs = filters.to ? parseBound(filters.to, "to") : Infinity;
  if (fromMs >= toMs) throw new FilterError(`"from" must be before "to"`);
  return calls.filter(
    (c) =>
      (!filters.feature || c.feature === filters.feature) &&
      (!filters.model || c.model === filters.model) &&
      c.tsMs >= fromMs &&
      c.tsMs < toMs,
  );
}
