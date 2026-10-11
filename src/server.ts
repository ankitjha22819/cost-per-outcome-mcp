import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { costByFeature } from "./analysis/costByFeature.js";
import { costPerOutcome } from "./analysis/costPerOutcome.js";
import { applyFilters, FilterError, type Filters } from "./analysis/filters.js";
import { modelSwapWhatif, WhatifError } from "./analysis/modelSwapWhatif.js";
import { resolvePeriodDays } from "./analysis/period.js";
import { groupRequests } from "./analysis/requests.js";
import { topExpensiveCalls } from "./analysis/topExpensiveCalls.js";
import type { AttemptedCall, Dataset } from "./dataset.js";
import {
  renderCostByFeature,
  renderCostPerOutcome,
  renderSwap,
  renderTopExpensive,
  type ReportContext,
} from "./format.js";
import { VERSION } from "./version.js";

export interface ServerSettings {
  periodDaysOverride?: number;
  currency: string;
  usingSampleTrace: boolean;
  /** "bundled" or the pricing file path. */
  pricingSource: string;
}

const filterShape = {
  feature: z.string().optional().describe('Only this feature/endpoint, e.g. "summarize" or "/api/chat"'),
  model: z.string().optional().describe("Only calls to this model (as named in the trace)"),
  from: z.string().optional().describe("Start, inclusive. ISO 8601 date or datetime, e.g. 2026-09-01"),
  to: z.string().optional().describe("End, exclusive. A plain date like 2026-09-30 includes that whole day"),
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  ...(isError ? { isError: true } : {}),
});

const distinct = (values: string[]) => [...new Set(values)].sort();

export function createServer(dataset: Dataset, settings: ServerSettings): McpServer {
  const server = new McpServer({ name: "cost-per-outcome-mcp", version: VERSION });

  function scopeLabel(f: Filters): string {
    const parts = [f.feature ? `Feature: ${f.feature}` : "All features"];
    if (f.model) parts.push(`model ${f.model}`);
    if (f.from) parts.push(`from ${f.from}`);
    if (f.to) parts.push(`to ${f.to}`);
    return parts.join(" · ");
  }

  function notes(calls: AttemptedCall[]): string[] {
    const out: string[] = [];
    const unpriced = new Map<string, number>();
    for (const c of calls) if (!c.priced) unpriced.set(c.model, (unpriced.get(c.model) ?? 0) + 1);
    if (unpriced.size > 0) {
      const list = [...unpriced].map(([model, n]) => `${model} (${n} calls)`).join(", ");
      out.push(`Unpriced models, token cost excluded: ${list}. Add them to the pricing table.`);
    }
    const skipped = dataset.skippedRows;
    if (skipped.length > 0) {
      out.push(`${skipped.length} invalid trace rows were skipped (first: line ${skipped[0].line}: ${skipped[0].message}).`);
    }
    if (settings.usingSampleTrace) {
      out.push("Using the bundled synthetic sample trace. Set COST_TRACE_PATH or --trace to analyse your own data.");
    }
    const source = settings.pricingSource === "bundled" ? "bundled table; override with COST_PRICING_PATH for your contracted rates" : settings.pricingSource;
    out.push(`Pricing as of ${dataset.pricing.as_of} (${source}).`);
    return out;
  }

  function noMatch(f: Filters): string {
    const all = dataset.calls;
    const first = all.reduce((a, b) => (b.tsMs < a.tsMs ? b : a));
    const last = all.reduce((a, b) => (b.tsMs > a.tsMs ? b : a));
    return [
      `No calls match ${scopeLabel(f)}.`,
      `Features in this trace: ${distinct(all.map((c) => c.feature)).join(", ")}`,
      `Models in this trace: ${distinct(all.map((c) => c.model)).join(", ")}`,
      `Time range: ${first.ts} → ${last.ts}`,
    ].join("\n");
  }

  function handle(filters: Filters, render: (calls: AttemptedCall[], ctx: ReportContext) => string) {
    try {
      const calls = applyFilters(dataset.calls, filters);
      if (calls.length === 0) return text(noMatch(filters));
      const ctx: ReportContext = {
        scope: scopeLabel(filters),
        periodDays: resolvePeriodDays(dataset.calls, filters, settings.periodDaysOverride),
        currency: settings.currency,
        notes: notes(calls),
      };
      return text(render(calls, ctx));
    } catch (err) {
      if (err instanceof FilterError || err instanceof WhatifError) return text(err.message, true);
      throw err;
    }
  }

  server.registerTool(
    "cost_per_outcome",
    {
      title: "Cost per successful outcome",
      description:
        "Run this first. Compares cost per request with cost per successful request (total spend ÷ requests that did their job) and splits the gap into retry and failed-request overhead. Answers questions like 'What does a successful summary cost us?'",
      inputSchema: filterShape,
      annotations: READ_ONLY,
    },
    async (args) => handle(args, (calls, ctx) => renderCostPerOutcome(costPerOutcome(groupRequests(calls)), ctx)),
  );

  server.registerTool(
    "cost_by_feature",
    {
      title: "Spend by feature",
      description:
        "Where is the money going? Spend per feature/endpoint, split by model and by cost layer (tokens, retrieval, retries), with a 30-day monthly projection. Answers questions like 'Which feature burns the most on retries?'",
      inputSchema: filterShape,
      annotations: READ_ONLY,
    },
    async (args) => handle(args, (calls, ctx) => renderCostByFeature(costByFeature(calls, ctx.periodDays), ctx)),
  );

  server.registerTool(
    "top_expensive_calls",
    {
      title: "Most expensive calls",
      description:
        "Which calls are bloated? The N most expensive individual calls with input token size vs the median and their share of total spend.",
      inputSchema: {
        ...filterShape,
        n: z.number().int().min(1).max(100).optional().describe("How many calls to return (default 10, max 100)"),
      },
      annotations: READ_ONLY,
    },
    async ({ n, ...filters }) => handle(filters, (calls, ctx) => renderTopExpensive(topExpensiveCalls(calls, n ?? 10), ctx)),
  );

  server.registerTool(
    "model_swap_whatif",
    {
      title: "Model swap what-if",
      description:
        "What if we switch models? Re-prices a feature's observed token volumes against a target model from the pricing table and projects monthly savings. Cost only, no quality signal: treat the result as 'worth testing', not 'safe to ship'. Answers questions like 'What do we save if classify moves to a smaller model?'",
      inputSchema: {
        ...filterShape,
        feature: z.string().describe("Feature to move (required)"),
        model: z.string().optional().describe("Current model to move away from. Default: every model the feature uses except the target"),
        target_model: z.string().describe("Model to move to; must exist in the pricing table"),
      },
      annotations: READ_ONLY,
    },
    async ({ target_model, ...filters }) =>
      handle(filters, (calls, ctx) =>
        renderSwap(
          modelSwapWhatif(calls, dataset.pricing, {
            feature: filters.feature,
            targetModel: target_model,
            sourceModel: filters.model,
            periodDays: ctx.periodDays,
          }),
          ctx,
        ),
      ),
  );

  return server;
}
