import type { AttemptedCall } from "../dataset.js";
import { monthly } from "./period.js";

export interface LayerCosts {
  tokens: number;
  retrieval: number;
  retries: number;
  total: number;
}

export interface ModelBreakdown extends LayerCosts {
  model: string;
  calls: number;
}

export interface FeatureCost extends LayerCosts {
  feature: string;
  calls: number;
  requests: number;
  /** Fraction of total spend, 0..1. */
  share: number;
  monthlyUsd: number;
  models: ModelBreakdown[];
}

export interface CostByFeatureResult {
  features: FeatureCost[];
  totalCostUsd: number;
  monthlyTotalUsd: number;
  periodDays: number;
}

const emptyLayers = (): LayerCosts => ({ tokens: 0, retrieval: 0, retries: 0, total: 0 });

/** D4: retries take the full cost of attempt > 1 calls; tokens/retrieval cover first attempts only. */
function addCall(target: LayerCosts, c: AttemptedCall): void {
  if (c.attemptN > 1) {
    target.retries += c.totalCostUsd;
  } else {
    target.tokens += c.tokenCostUsd;
    target.retrieval += c.retrievalCostUsd;
  }
  target.total += c.totalCostUsd;
}

export function costByFeature(calls: AttemptedCall[], periodDays: number): CostByFeatureResult {
  const features = new Map<string, { layers: LayerCosts; calls: number; requestIds: Set<string>; models: Map<string, ModelBreakdown> }>();

  for (const c of calls) {
    let f = features.get(c.feature);
    if (!f) {
      f = { layers: emptyLayers(), calls: 0, requestIds: new Set(), models: new Map() };
      features.set(c.feature, f);
    }
    addCall(f.layers, c);
    f.calls++;
    f.requestIds.add(c.request_id);

    let m = f.models.get(c.model);
    if (!m) {
      m = { model: c.model, calls: 0, ...emptyLayers() };
      f.models.set(c.model, m);
    }
    addCall(m, c);
    m.calls++;
  }

  const totalCostUsd = calls.reduce((sum, c) => sum + c.totalCostUsd, 0);
  const rows: FeatureCost[] = [...features.entries()].map(([feature, f]) => ({
    feature,
    ...f.layers,
    calls: f.calls,
    requests: f.requestIds.size,
    share: totalCostUsd === 0 ? 0 : f.layers.total / totalCostUsd,
    monthlyUsd: monthly(f.layers.total, periodDays),
    models: [...f.models.values()].sort((a, b) => b.total - a.total),
  }));
  rows.sort((a, b) => b.total - a.total);

  return { features: rows, totalCostUsd, monthlyTotalUsd: monthly(totalCostUsd, periodDays), periodDays };
}
