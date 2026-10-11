import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DEFAULT_TRACE_PATH = fileURLToPath(new URL("../data/sample-traces.jsonl", import.meta.url));
export const DEFAULT_PRICING_PATH = fileURLToPath(new URL("../data/pricing.json", import.meta.url));

export interface Config {
  tracePath: string;
  pricingPath: string;
  /** undefined = infer from timestamps. */
  periodDays?: number;
  currency: string;
  usingSampleTrace: boolean;
  usingBundledPricing: boolean;
}

export type Cli = { kind: "run"; config: Config } | { kind: "help" } | { kind: "version" };

export class ConfigError extends Error {}

export const HELP = `cost-per-outcome-mcp: read-only MCP server for LLM cost per successful outcome

Usage: cost-per-outcome-mcp [--trace <file>] [--pricing <file>] [--period-days <n>]

  --trace <file>        .jsonl or .csv trace       (env COST_TRACE_PATH, default: bundled sample)
  --pricing <file>      pricing table JSON         (env COST_PRICING_PATH, default: bundled pricing.json)
  --period-days <n>     window for monthly figures (env COST_PERIOD_DAYS, default: inferred)
  -h, --help            show this help
  -v, --version         print version

Env COST_CURRENCY sets the display label only (default USD, no FX conversion).
Speaks MCP over stdio. Add it to Claude Desktop or Cursor; see README.`;

const OPTIONS = {
  trace: { type: "string" },
  pricing: { type: "string" },
  "period-days": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

function parseFlags(argv: string[]) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }).values;
  } catch (err) {
    throw new ConfigError(`${(err as Error).message}\n\n${HELP}`);
  }
}

const nonEmpty = (v: string | undefined) => (v !== undefined && v.trim() !== "" ? v.trim() : undefined);

function toPath(value: string, cwd: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(cwd, value);
}

export function resolveConfig(argv: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()): Cli {
  const flags = parseFlags(argv);
  if (flags.help) return { kind: "help" };
  if (flags.version) return { kind: "version" };

  const trace = nonEmpty(flags.trace) ?? nonEmpty(env.COST_TRACE_PATH);
  const pricing = nonEmpty(flags.pricing) ?? nonEmpty(env.COST_PRICING_PATH);
  const periodRaw = nonEmpty(flags["period-days"]) ?? nonEmpty(env.COST_PERIOD_DAYS);

  let periodDays: number | undefined;
  if (periodRaw !== undefined) {
    periodDays = Number(periodRaw);
    if (!Number.isFinite(periodDays) || periodDays <= 0) {
      throw new ConfigError(`Invalid period days "${periodRaw}": must be a positive number`);
    }
  }

  return {
    kind: "run",
    config: {
      tracePath: trace ? toPath(trace, cwd) : DEFAULT_TRACE_PATH,
      pricingPath: pricing ? toPath(pricing, cwd) : DEFAULT_PRICING_PATH,
      periodDays,
      currency: nonEmpty(env.COST_CURRENCY)?.toUpperCase() ?? "USD",
      usingSampleTrace: !trace,
      usingBundledPricing: !pricing,
    },
  };
}
