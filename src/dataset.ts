import { priceCall, type PricedCall, type PricingTable } from "./pricing.js";
import type { LoadedTrace, RowError } from "./types.js";

export type AttemptedCall = PricedCall & { attemptN: number };

export interface Dataset {
  calls: AttemptedCall[];
  pricing: PricingTable;
  skippedRows: RowError[];
  traceSource: string;
}

/**
 * D6: an explicit `attempt` wins. Otherwise calls are numbered 1..n within their
 * request_id by ts, with file order breaking ties. Run once over the whole trace,
 * before filtering, so filters never renumber attempts.
 */
export function annotateAttempts(calls: PricedCall[]): AttemptedCall[] {
  const byRequest = new Map<string, number[]>();
  calls.forEach((c, i) => {
    const list = byRequest.get(c.request_id);
    if (list) list.push(i);
    else byRequest.set(c.request_id, [i]);
  });

  const attemptN: number[] = new Array(calls.length);
  for (const indexes of byRequest.values()) {
    const ordered = [...indexes].sort((a, b) => calls[a].tsMs - calls[b].tsMs || a - b);
    ordered.forEach((idx, pos) => {
      attemptN[idx] = calls[idx].attempt ?? pos + 1;
    });
  }
  return calls.map((c, i) => ({ ...c, attemptN: attemptN[i] }));
}

export function buildDataset(trace: LoadedTrace, pricing: PricingTable): Dataset {
  return {
    calls: annotateAttempts(trace.rows.map((row) => priceCall(row, pricing))),
    pricing,
    skippedRows: trace.errors,
    traceSource: trace.source,
  };
}
