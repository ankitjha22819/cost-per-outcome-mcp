import type { CostByFeatureResult } from "./analysis/costByFeature.js";
import type { CostPerOutcomeResult } from "./analysis/costPerOutcome.js";
import type { SwapResult } from "./analysis/modelSwapWhatif.js";
import type { TopExpensiveResult } from "./analysis/topExpensiveCalls.js";

export interface ReportContext {
  /** e.g. "Feature: summarize" or "All features". */
  scope: string;
  periodDays: number;
  /** Display label only; values are never converted. */
  currency: string;
  notes: string[];
}

const RULE = "─".repeat(57);

export function money(n: number, currency: string, digits = 2): string {
  const d = digits === 2 && n !== 0 && Math.abs(n) < 0.01 ? 4 : digits;
  if (currency !== "USD") return `${n.toFixed(d)} ${currency}`;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(d)}`;
}

export function pct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function signedPct(fraction: number): string {
  return `${fraction >= 0 ? "+" : ""}${pct(fraction)}`;
}

const int = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const days = (d: number) => `${+d.toFixed(1)} days`;
const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

function row(label: string, value: string, note = ""): string {
  return `${label.padEnd(25)}${value.padEnd(10)}${note}`.trimEnd();
}

function withNotes(lines: string[], notes: string[]): string {
  return [...lines, ...(notes.length ? ["", ...notes.map((n) => `Note: ${n}`)] : [])].join("\n");
}

export function renderCostPerOutcome(r: CostPerOutcomeResult, ctx: ReportContext): string {
  const m = (n: number, d?: number) => money(n, ctx.currency, d);
  const perSuccess = r.costPerSuccessUsd === null ? "n/a (no successful requests)" : m(r.costPerSuccessUsd, 4);
  const overhead = r.overheadPct === null ? "" : `← ${signedPct(r.overheadPct)} vs per-request`;
  const takeaway =
    r.costPerSuccessUsd === null || r.overheadPct === null
      ? "No request in this selection succeeded, so none of this spend bought a usable result."
      : `Cost per request says ${m(r.costPerRequestUsd, 4)}. What you actually pay for a request that works is ${m(r.costPerSuccessUsd, 4)}. That ${pct(r.overheadPct)} is spend with nothing to show for it.`;

  const notes = [...ctx.notes];
  if (r.outcomeInferredRequests > 0) {
    notes.unshift(
      `${r.outcomeInferredRequests} of ${r.requests} requests had no outcome field; success was inferred as "final attempt has status ok". That's a floor, not the truth.`,
    );
  }

  return withNotes(
    [
      `${ctx.scope}   (${days(ctx.periodDays)})`,
      RULE,
      row("Requests", int(r.requests)),
      row("Calls (incl. retries)", int(r.calls), r.retryCalls ? `+${int(r.retryCalls)} retry calls` : ""),
      row("Successful outcomes", int(r.successes), pct(r.successRate, 1)),
      row("Total spend", m(r.totalCostUsd)),
      "",
      row("Cost per request", m(r.costPerRequestUsd, 4)),
      row("Cost per success", perSuccess, overhead),
      "",
      "Overhead breakdown",
      row("  Retries", m(r.retryOverheadUsd), pct(share(r.retryOverheadUsd, r.totalCostUsd))),
      row("  Failed requests", m(r.failedRequestsUsd), pct(share(r.failedRequestsUsd, r.totalCostUsd))),
      "",
      takeaway,
    ],
    notes,
  );
}

export function renderCostByFeature(r: CostByFeatureResult, ctx: ReportContext): string {
  const m = (n: number) => money(n, ctx.currency);
  const w = Math.max(12, ...r.features.flatMap((f) => [f.feature.length, ...f.models.map((x) => x.model.length + 2)])) + 2;
  const cols = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(w) : c.padEnd(11))).join("").trimEnd();

  const lines = [
    `Spend by feature   ${ctx.scope} · ${days(ctx.periodDays)}`,
    RULE,
    cols(["Feature", "Spend", "Share", "Monthly", "Tokens", "Retrieval", "Retries", "Calls"]),
  ];
  for (const f of r.features) {
    lines.push(cols([f.feature, m(f.total), pct(f.share), m(f.monthlyUsd), m(f.tokens), m(f.retrieval), m(f.retries), int(f.calls)]));
    for (const x of f.models) {
      lines.push(cols([`  ${x.model}`, m(x.total), pct(share(x.total, f.total)), "", m(x.tokens), m(x.retrieval), m(x.retries), int(x.calls)]));
    }
  }
  lines.push(RULE, cols(["Total", m(r.totalCostUsd), "100%", m(r.monthlyTotalUsd)]));

  const top = r.features[0];
  if (top) lines.push("", `${top.feature} is ${pct(top.share)} of spend. Retries account for ${m(top.retries)} of it.`);
  return withNotes(lines, ctx.notes);
}

export function renderTopExpensive(r: TopExpensiveResult, ctx: ReportContext): string {
  const lines = [
    `Top ${r.calls.length} most expensive calls   ${ctx.scope} · ${days(ctx.periodDays)}`,
    RULE,
    `These ${r.calls.length} calls are ${pct(r.topShare, 1)} of ${money(r.totalCostUsd, ctx.currency)} spend across ${int(r.totalCalls)} calls. Median input: ${int(r.medianInputTokens)} tokens.`,
  ];
  r.calls.forEach(({ call: c, share: s, inputVsMedian }, i) => {
    const bloat = inputVsMedian === null ? "" : ` (${inputVsMedian.toFixed(1)}× median)`;
    const latency = c.latency_ms === undefined ? "" : ` · ${int(c.latency_ms)} ms`;
    const unpriced = c.priced ? "" : " · UNPRICED MODEL";
    lines.push(
      "",
      `#${i + 1}  ${money(c.totalCostUsd, ctx.currency, 4)}   ${pct(s, 1)} of spend   ${c.feature} · ${c.model} · attempt ${c.attemptN} · ${c.status}${unpriced}`,
      `    request ${c.request_id} · ${c.ts} · in ${int(c.input_tokens)} tok${bloat} · out ${int(c.output_tokens)} tok${latency}`,
    );
  });
  return withNotes(lines, ctx.notes);
}

export function renderSwap(r: SwapResult, ctx: ReportContext): string {
  const m = (n: number) => money(n, ctx.currency);
  const notes = [...ctx.notes];
  if (r.excludedUnpricedCalls > 0) notes.unshift(`${r.excludedUnpricedCalls} calls on unpriced models were left out of the comparison.`);
  if (r.overriddenCostCalls > 0) notes.unshift(`${r.overriddenCostCalls} calls used cost_usd from the trace as their current cost.`);

  const lines = [
    `What-if: ${r.feature}  ${r.sourceModels.join(", ")} → ${r.targetModel}   (${days(r.periodDays)} observed, pricing as of ${r.asOf})`,
    RULE,
    row("Calls repriced", int(r.calls)),
    row("Tokens", `in ${compact(r.inputTokens)} (cached ${compact(r.cachedInputTokens)}) · out ${compact(r.outputTokens)}`),
    row("Current cost", m(r.currentCostUsd), `→ ${m(r.currentMonthlyUsd)} / month`),
    row("Projected cost", m(r.projectedCostUsd), `→ ${m(r.projectedMonthlyUsd)} / month`),
    row("Estimated savings", `${m(r.savingsUsd)} (${pct(r.savingsPct)})`, `  → ${m(r.monthlySavingsUsd)} / month`),
  ];
  if (r.savingsUsd < 0) lines.push("", `${r.targetModel} costs more than the current model for this traffic.`);
  lines.push(
    "",
    "Caveat: this estimates cost only. It assumes the target model uses the same token counts (tokenizers differ, so expect ±10–20% drift) and says nothing about quality. Treat it as \"worth testing\", not \"safe to ship\". Validate against your evals, then re-run cost_per_outcome on a test batch: a cheaper model that fails more often can cost more per success.",
  );
  return withNotes(lines, notes);
}
