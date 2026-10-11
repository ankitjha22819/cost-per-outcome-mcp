import type { RequestGroup } from "./requests.js";

export interface CostPerOutcomeResult {
  requests: number;
  calls: number;
  retryCalls: number;
  successes: number;
  /** Fraction, 0..1. */
  successRate: number;
  totalCostUsd: number;
  costPerRequestUsd: number;
  /** null when no request succeeded. */
  costPerSuccessUsd: number | null;
  /** cost_per_success / cost_per_request − 1, as a fraction. */
  overheadPct: number | null;
  /** D5: cost of attempt > 1 calls inside successful requests. */
  retryOverheadUsd: number;
  /** D5: full cost of every call in failed requests. */
  failedRequestsUsd: number;
  outcomeInferredRequests: number;
  unpricedCalls: number;
}

export function costPerOutcome(groups: RequestGroup[]): CostPerOutcomeResult {
  let calls = 0;
  let retryCalls = 0;
  let successes = 0;
  let totalCostUsd = 0;
  let retryOverheadUsd = 0;
  let failedRequestsUsd = 0;
  let outcomeInferredRequests = 0;
  let unpricedCalls = 0;

  for (const g of groups) {
    totalCostUsd += g.totalCostUsd;
    if (g.outcomeInferred) outcomeInferredRequests++;
    if (g.success) successes++;
    else failedRequestsUsd += g.totalCostUsd;
    for (const c of g.calls) {
      calls++;
      if (!c.priced) unpricedCalls++;
      if (c.attemptN > 1) {
        retryCalls++;
        if (g.success) retryOverheadUsd += c.totalCostUsd;
      }
    }
  }

  const requests = groups.length;
  const costPerRequestUsd = requests === 0 ? 0 : totalCostUsd / requests;
  const costPerSuccessUsd = successes === 0 ? null : totalCostUsd / successes;
  const overheadPct =
    costPerSuccessUsd === null || costPerRequestUsd === 0 ? null : costPerSuccessUsd / costPerRequestUsd - 1;

  return {
    requests,
    calls,
    retryCalls,
    successes,
    successRate: requests === 0 ? 0 : successes / requests,
    totalCostUsd,
    costPerRequestUsd,
    costPerSuccessUsd,
    overheadPct,
    retryOverheadUsd,
    failedRequestsUsd,
    outcomeInferredRequests,
    unpricedCalls,
  };
}
