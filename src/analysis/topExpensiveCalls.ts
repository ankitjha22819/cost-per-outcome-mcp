import type { AttemptedCall } from "../dataset.js";

export interface ExpensiveCall {
  call: AttemptedCall;
  /** Fraction of total spend in the selection, 0..1. */
  share: number;
  /** input_tokens ÷ median input_tokens; null when the median is 0. */
  inputVsMedian: number | null;
}

export interface TopExpensiveResult {
  calls: ExpensiveCall[];
  totalCostUsd: number;
  totalCalls: number;
  medianInputTokens: number;
  /** Combined share of the returned calls. */
  topShare: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function topExpensiveCalls(calls: AttemptedCall[], n: number): TopExpensiveResult {
  const totalCostUsd = calls.reduce((sum, c) => sum + c.totalCostUsd, 0);
  const medianInputTokens = median(calls.map((c) => c.input_tokens));
  const top = [...calls]
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd || a.tsMs - b.tsMs)
    .slice(0, n)
    .map((call) => ({
      call,
      share: totalCostUsd === 0 ? 0 : call.totalCostUsd / totalCostUsd,
      inputVsMedian: medianInputTokens === 0 ? null : call.input_tokens / medianInputTokens,
    }));
  return {
    calls: top,
    totalCostUsd,
    totalCalls: calls.length,
    medianInputTokens,
    topShare: top.reduce((sum, e) => sum + e.share, 0),
  };
}
