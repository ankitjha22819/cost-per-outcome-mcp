import type { AttemptedCall } from "../dataset.js";
import { tokenCost, type PricingTable } from "../pricing.js";
import { monthly } from "./period.js";

export interface SwapInput {
  feature: string;
  targetModel: string;
  /** Default: every model in the feature except the target. */
  sourceModel?: string;
  periodDays: number;
}

export interface SwapResult {
  feature: string;
  sourceModels: string[];
  targetModel: string;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  currentCostUsd: number;
  projectedCostUsd: number;
  savingsUsd: number;
  /** Fraction of current cost, 0..1 (negative = the target costs more). */
  savingsPct: number;
  currentMonthlyUsd: number;
  projectedMonthlyUsd: number;
  monthlySavingsUsd: number;
  periodDays: number;
  excludedUnpricedCalls: number;
  /** Calls whose current cost came from cost_usd rather than the pricing table. */
  overriddenCostCalls: number;
  asOf: string;
}

export class WhatifError extends Error {}

/** D10: token cost only (retrieval doesn't change with the model), same token counts assumed. */
export function modelSwapWhatif(calls: AttemptedCall[], pricing: PricingTable, input: SwapInput): SwapResult {
  const { feature, targetModel, sourceModel, periodDays } = input;
  const target = pricing.models[targetModel];
  if (!target) {
    throw new WhatifError(
      `Unknown target model "${targetModel}". Models in the pricing table: ${Object.keys(pricing.models).join(", ")}`,
    );
  }
  if (sourceModel === targetModel) throw new WhatifError("Source and target model are the same.");

  const candidates = calls.filter(
    (c) => c.feature === feature && (sourceModel ? c.model === sourceModel : c.model !== targetModel),
  );
  if (candidates.length === 0) {
    const scope = sourceModel ? `on model "${sourceModel}"` : `on models other than "${targetModel}"`;
    throw new WhatifError(`No calls for feature "${feature}" ${scope} in the selected window.`);
  }

  const repriced = candidates.filter((c) => c.priced);
  if (repriced.length === 0) {
    const models = [...new Set(candidates.map((c) => c.model))].join(", ");
    throw new WhatifError(`All ${candidates.length} matching calls use models missing from the pricing table (${models}).`);
  }

  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let currentCostUsd = 0;
  let projectedCostUsd = 0;
  let overriddenCostCalls = 0;
  for (const c of repriced) {
    inputTokens += c.input_tokens;
    cachedInputTokens += c.cached_input_tokens ?? 0;
    outputTokens += c.output_tokens;
    currentCostUsd += c.tokenCostUsd;
    projectedCostUsd += tokenCost(c, target);
    if (c.cost_usd !== undefined) overriddenCostCalls++;
  }

  const savingsUsd = currentCostUsd - projectedCostUsd;
  return {
    feature,
    sourceModels: [...new Set(repriced.map((c) => c.model))].sort(),
    targetModel,
    calls: repriced.length,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    currentCostUsd,
    projectedCostUsd,
    savingsUsd,
    savingsPct: currentCostUsd === 0 ? 0 : savingsUsd / currentCostUsd,
    currentMonthlyUsd: monthly(currentCostUsd, periodDays),
    projectedMonthlyUsd: monthly(projectedCostUsd, periodDays),
    monthlySavingsUsd: monthly(savingsUsd, periodDays),
    periodDays,
    excludedUnpricedCalls: candidates.length - repriced.length,
    overriddenCostCalls,
    asOf: pricing.as_of,
  };
}
