import type { AttemptedCall } from "../dataset.js";

export interface RequestGroup {
  request_id: string;
  feature: string;
  /** Sorted by attemptN. */
  calls: AttemptedCall[];
  success: boolean;
  /** true = the final attempt had no outcome, so success was read from its status. */
  outcomeInferred: boolean;
  totalCostUsd: number;
}

export function groupRequests(calls: AttemptedCall[]): RequestGroup[] {
  const byRequest = new Map<string, AttemptedCall[]>();
  for (const call of calls) {
    const list = byRequest.get(call.request_id);
    if (list) list.push(call);
    else byRequest.set(call.request_id, [call]);
  }

  return [...byRequest.entries()].map(([request_id, list]) => {
    const ordered = [...list].sort((a, b) => a.attemptN - b.attemptN || a.tsMs - b.tsMs);
    const final = ordered[ordered.length - 1];
    const outcomeInferred = final.outcome === undefined;
    return {
      request_id,
      feature: ordered[0].feature,
      calls: ordered,
      success: outcomeInferred ? final.status === "ok" : final.outcome === "success",
      outcomeInferred,
      totalCostUsd: ordered.reduce((sum, c) => sum + c.totalCostUsd, 0),
    };
  });
}
