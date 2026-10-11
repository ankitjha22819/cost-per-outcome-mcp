import { readFileSync } from "node:fs";
import { z } from "zod";
import type { TraceRow } from "./types.js";

const ModelPriceSchema = z.object({
  input: z.number().nonnegative(),
  cached_input: z.number().nonnegative().optional(),
  output: z.number().nonnegative(),
});

const PricingSchema = z.object({
  as_of: z.string().min(1),
  models: z.record(ModelPriceSchema),
});

/** USD per 1M tokens. */
export type ModelPrice = z.infer<typeof ModelPriceSchema>;
export type PricingTable = z.infer<typeof PricingSchema>;

export class PricingLoadError extends Error {}

export function loadPricing(path: string): PricingTable {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new PricingLoadError(`Cannot read pricing table "${path}": ${(err as Error).message}`);
  }
  const parsed = PricingSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PricingLoadError(`Invalid pricing table "${path}": ${issue?.path.join(".")} ${issue?.message}`);
  }
  return parsed.data;
}

/** input_tokens includes cached_input_tokens (D1). No cached rate → billed at input rate (D2). */
export function tokenCost(
  row: Pick<TraceRow, "input_tokens" | "output_tokens" | "cached_input_tokens">,
  price: ModelPrice,
): number {
  const cached = row.cached_input_tokens ?? 0;
  const uncached = row.input_tokens - cached;
  const cachedRate = price.cached_input ?? price.input;
  return (uncached * price.input + cached * cachedRate + row.output_tokens * price.output) / 1_000_000;
}

export interface PricedCall extends TraceRow {
  tokenCostUsd: number;
  retrievalCostUsd: number;
  totalCostUsd: number;
  /** false = model missing from the pricing table and no cost_usd override. */
  priced: boolean;
}

export function priceCall(row: TraceRow, pricing: PricingTable): PricedCall {
  const retrieval = row.retrieval_cost_usd ?? 0;
  if (row.cost_usd !== undefined) {
    return { ...row, tokenCostUsd: row.cost_usd, retrievalCostUsd: retrieval, totalCostUsd: row.cost_usd + retrieval, priced: true };
  }
  const price = pricing.models[row.model];
  if (!price) {
    return { ...row, tokenCostUsd: 0, retrievalCostUsd: retrieval, totalCostUsd: retrieval, priced: false };
  }
  const tokens = tokenCost(row, price);
  return { ...row, tokenCostUsd: tokens, retrievalCostUsd: retrieval, totalCostUsd: tokens + retrieval, priced: true };
}
