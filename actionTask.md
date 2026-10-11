# cost-per-outcome-mcp — Implementation Plan (v0.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `cost-per-outcome-mcp`, a read-only stdio MCP server that loads a JSONL/CSV trace of LLM calls and answers cost questions through four tools: `cost_by_feature`, `cost_per_outcome`, `top_expensive_calls`, `model_swap_whatif`.

**Architecture:** Pure, separately tested layers: **load** (parse + validate rows) → **price** (pricing table → per-call cost) → **dataset** (attempt numbering, done once at startup) → **analysis** (filter, group into requests, compute one typed result per tool) → **format** (typed result → plain-text report) → **server** (MCP tool registration) → **CLI** (flags/env → stdio transport). Analysis functions never touch I/O, so most tests are plain unit tests. The trace and pricing files are read once at startup. Nothing is written to disk and nothing goes over the network.

**Tech Stack:** Node ≥ 20, TypeScript 5 (ESM, `NodeNext`), `@modelcontextprotocol/sdk` v1 (`McpServer`, `StdioServerTransport`), `zod` v3, `csv-parse`, Vitest 3, `tsx` for dev scripts.

**Spec:** [Readme.md](Readme.md). Read it before starting any task.

## Global Constraints

Every task must follow these rules. They are copied from the spec or decided below.

- Package name `cost-per-outcome-mcp`, bin `cost-per-outcome-mcp`, version `0.1.0`, license MIT.
- Tool names exactly: `cost_by_feature`, `cost_per_outcome`, `top_expensive_calls`, `model_swap_whatif`.
- All four tools accept the optional filters `feature`, `model`, `from`, `to`.
- Config precedence: CLI flag > env var > default. Flags/envs: `--trace`/`COST_TRACE_PATH` (default bundled `data/sample-traces.jsonl`), `--pricing`/`COST_PRICING_PATH` (default bundled `data/pricing.json`), `--period-days`/`COST_PERIOD_DAYS` (default inferred from timestamps), `COST_CURRENCY` (default `USD`, display only, no FX conversion).
- Prices are USD per 1M tokens. `pricing.json` has an `as_of` date, and every report shows it.
- Formulas, verbatim:
  - `cost_per_request = Σ cost(all calls) / count(distinct request_id)`
  - `cost_per_success = Σ cost(all calls) / count(request_id where outcome = success)`
  - `overhead_pct = cost_per_success / cost_per_request − 1`
- Unknown model names are **reported, never silently priced at zero**.
- If `outcome` is missing, fall back to "final attempt has `status: ok`" **and say so in the output**.
- **Read-only:** no network modules, no file writes, no child processes, no credentials in `src/`. Enforced by a test in Task 16.
- **stdout belongs to MCP.** Never `console.log` in `src/`. Diagnostics go to `console.error`.
- Monthly projections = observed cost × `30 / periodDays`.
- `model_swap_whatif` output must always include the caveat: cost estimate only, same token counts assumed (±10–20% tokenizer drift), no quality signal. Treat the result as "worth testing", not "safe to ship".

## Decisions (where the spec is ambiguous)

These are locked in. Each one gets a line in the README (Task 17) so users know.

| # | Question | Decision |
|---|----------|----------|
| D1 | Does `input_tokens` include `cached_input_tokens`? | **Yes** (OpenAI-style). Billable uncached = `input_tokens − cached_input_tokens`. A row with `cached > input` is invalid. |
| D2 | Model has no `cached_input` price | Cached tokens are billed at the `input` rate. |
| D3 | `cost_usd` present | Replaces the computed token cost. `retrieval_cost_usd` is still added on top. |
| D4 | Cost layers (`cost_by_feature`) | Non-overlapping, and they add up to the total: **Tokens** = token cost of first attempts, **Retrieval** = retrieval cost of first attempts, **Retries** = full cost of every call with attempt > 1. |
| D5 | Overhead breakdown (`cost_per_outcome`) | **Retries** = cost of attempt > 1 calls inside *successful* requests. **Failed requests** = full cost of every call in *failed* requests. No double counting. |
| D6 | Missing `attempt` | Calls are numbered 1..n within each `request_id`, ordered by `ts` (file order breaks ties). Numbering happens **once over the whole trace**, before any filter. |
| D7 | `from` / `to` | `from` is inclusive, `to` is exclusive. A date-only `to` (`2026-09-15`) covers that whole day. Invalid dates return a tool error. |
| D8 | Period for monthly figures | `--period-days` if set. Otherwise the span (max ts − min ts, minimum 1 day) of calls inside the `from`/`to` window. Feature/model filters are ignored here so that a sparse feature isn't over-projected. |
| D9 | Invalid rows | Skipped and counted. Reports show the skipped count and the first error. A missing/unreadable file, a malformed CSV, or zero valid rows is a fatal startup error. |
| D10 | `model_swap_whatif` scope | `feature` is required and `target_model` is required. The `model` filter acts as the source model (default: every model in the feature except the target). Compares token cost only (retrieval doesn't change). Unpriced source calls are excluded and counted. |
| D11 | Unpriced calls | Token cost = 0, but they're flagged `priced: false`, and every report lists `model (N calls)` in a note. |

## File Structure

```
cost-per-outcome-mcp/
├── package.json · tsconfig.json · tsconfig.build.json
├── vitest.config.ts · vitest.e2e.config.ts · .gitignore · LICENSE · CHANGELOG.md · README.md
├── .github/workflows/ci.yml
├── data/
│   ├── pricing.json              # bundled, date-stamped pricing table
│   └── sample-traces.jsonl       # generated by scripts/gen-sample.ts (committed)
├── scripts/
│   ├── sample.ts                 # pure, seeded synthetic-trace generator
│   └── gen-sample.ts             # writes data/sample-traces.jsonl
├── src/
│   ├── index.ts                  # CLI entry (shebang) → stdio server
│   ├── version.ts                # VERSION constant
│   ├── config.ts                 # flags/env → Config; bundled default paths
│   ├── types.ts                  # TraceRow, RowError, LoadedTrace
│   ├── load/validate.ts          # raw record → TraceRow | RowError
│   ├── load/parse.ts             # JSONL + CSV text → raw records
│   ├── load/loadTrace.ts         # file → LoadedTrace (fatal errors as TraceLoadError)
│   ├── pricing.ts                # PricingTable, loadPricing, tokenCost, priceCall
│   ├── dataset.ts                # AttemptedCall, annotateAttempts, buildDataset
│   ├── analysis/filters.ts       # Filters, applyFilters, FilterError
│   ├── analysis/period.ts        # inferPeriodDays, monthly
│   ├── analysis/requests.ts      # RequestGroup, groupRequests
│   ├── analysis/costPerOutcome.ts
│   ├── analysis/costByFeature.ts
│   ├── analysis/topExpensiveCalls.ts
│   ├── analysis/modelSwapWhatif.ts
│   ├── format.ts                 # money/pct helpers + one render function per tool
│   └── server.ts                 # createServer(dataset, settings) → McpServer
└── tests/
    ├── helpers.ts                # makeRow / makeCall builders
    ├── fixtures/mini.jsonl · fixtures/mini.csv · fixtures/pricing.json
    ├── *.test.ts                 # unit + in-memory MCP integration
    ├── readonly.test.ts          # read-only guard
    └── e2e/stdio.test.ts         # spawns dist/index.js over real stdio
```

## Phase Overview

| Phase | Tasks | Deliverable |
|-------|-------|-------------|
| 0 · Foundation | 1 | Repo builds, Vitest runs |
| 1 · Ingestion | 2–4 | Trace + pricing load, validate, and price |
| 2 · Analysis core | 5–10 | Typed results for all four tools |
| 3 · Presentation | 11 | Human-readable reports matching the README style |
| 4 · MCP + CLI | 12–15 | Config, MCP tools, sample data, working `npx cost-per-outcome-mcp` with e2e tests over stdio |
| 5 · Hardening | 16 | Read-only guard, CI matrix |
| 6 · Launch | 17 | README/LICENSE/CHANGELOG, manual QA in Claude Desktop + Cursor, npm publish |

**Definition of done for v0.1:** `npm run typecheck && npm test && npm run test:e2e` is green on Node 20/22/24. `npx @modelcontextprotocol/inspector node dist/index.js` lists the 4 tools and each one returns a sensible report on the bundled sample. Claude Desktop and Cursor answer the three README example questions. `npm pack --dry-run` ships only `dist/`, `data/`, `README.md`, `LICENSE`, and `package.json`.

---

## Phase 0 · Foundation

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `vitest.e2e.config.ts`, `.gitignore`, `src/version.ts`
- Test: `tests/version.test.ts`

**Interfaces:**
- Produces: `VERSION: string` from `src/version.ts`; npm scripts `build`, `dev`, `typecheck`, `test`, `test:e2e`, `gen:sample`.

- [ ] **Step 1: Init git and npm**

```bash
git init
npm init -y
npm install @modelcontextprotocol/sdk@^1 zod@^3.25 csv-parse@^5
npm install -D typescript@^5 vitest@^3 tsx@^4 @types/node@^22
```

- [ ] **Step 2: Replace `package.json` fields** (keep the `dependencies`/`devDependencies` npm wrote)

```json
{
  "name": "cost-per-outcome-mcp",
  "version": "0.1.0",
  "description": "Read-only MCP server: ask your LLM trace logs what a successful request actually costs.",
  "type": "module",
  "bin": { "cost-per-outcome-mcp": "dist/index.js" },
  "files": ["dist", "data", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "npm run build && vitest run --config vitest.e2e.config.ts",
    "gen:sample": "tsx scripts/gen-sample.ts",
    "prepublishOnly": "npm run typecheck && npm test && npm run test:e2e"
  },
  "keywords": ["mcp", "model-context-protocol", "llm", "cost", "finops", "claude", "cursor"],
  "license": "MIT"
}
```

- [ ] **Step 3: TypeScript configs**

`tsconfig.json` (typecheck everything, no emit):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests", "scripts", "vitest.config.ts", "vitest.e2e.config.ts"]
}
```

`tsconfig.build.json` (emit `src/` → `dist/`, so `dist/config.js` and `src/config.ts` both sit one level below `data/`):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist", "sourceMap": true },
  "include": ["src"]
}
```

- [ ] **Step 4: Vitest configs and .gitignore**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], exclude: ["tests/e2e/**", "node_modules/**"] },
});
```

`vitest.e2e.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/e2e/**/*.test.ts"], testTimeout: 20_000 },
});
```

`.gitignore`:
```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 5: Write the failing test** `tests/version.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("VERSION", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run tests/version.test.ts`
Expected: FAIL, cannot resolve `../src/version.js`.

- [ ] **Step 7: Implement** `src/version.ts`

```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 8: Run tests and typecheck, confirm both pass**

Run: `npm test && npm run typecheck`
Expected: 1 test passes; tsc exits 0.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript MCP project"
```

---
## Phase 1 · Ingestion

### Task 2: Trace types and row validation

**Files:**
- Create: `src/types.ts`, `src/load/validate.ts`
- Test: `tests/validate.test.ts`

**Interfaces:**
- Produces:
  - `type CallStatus = "ok" | "error" | "timeout"`, `type Outcome = "success" | "failure"`
  - `interface TraceRow { ts: string; tsMs: number; request_id: string; feature: string; model: string; input_tokens: number; output_tokens: number; cached_input_tokens?: number; attempt?: number; status: CallStatus; outcome?: Outcome; retrieval_cost_usd?: number; cost_usd?: number; latency_ms?: number; line: number }`
  - `interface RowError { line: number; message: string }`
  - `interface LoadedTrace { rows: TraceRow[]; errors: RowError[]; source: string }`
  - `validateRow(raw: Record<string, unknown>, line: number): { ok: true; row: TraceRow } | { ok: false; error: RowError }`. Takes JSON values or CSV strings. `""`, `null`, and `undefined` all count as missing.

- [ ] **Step 1: Write `src/types.ts`** (types only, nothing to test yet)

```ts
export type CallStatus = "ok" | "error" | "timeout";
export type Outcome = "success" | "failure";

/** One validated LLM call. Field names follow the README trace schema. */
export interface TraceRow {
  ts: string;
  tsMs: number;
  request_id: string;
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  attempt?: number;
  status: CallStatus;
  outcome?: Outcome;
  retrieval_cost_usd?: number;
  cost_usd?: number;
  latency_ms?: number;
  /** 1-based line in the source file, for error messages. */
  line: number;
}

export interface RowError {
  line: number;
  message: string;
}

export interface LoadedTrace {
  rows: TraceRow[];
  errors: RowError[];
  source: string;
}
```

- [ ] **Step 2: Write the failing tests** `tests/validate.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { validateRow } from "../src/load/validate.js";

const base = {
  ts: "2026-09-14T10:02:11Z",
  request_id: "r_8812",
  feature: "summarize",
  model: "model-large",
  input_tokens: 6120,
  output_tokens: 410,
  status: "timeout",
  attempt: 1,
};

describe("validateRow", () => {
  it("accepts a valid JSON row", () => {
    const r = validateRow(base, 3);
    expect(r).toEqual({
      ok: true,
      row: { ...base, tsMs: Date.parse(base.ts), line: 3 },
    });
  });

  it("coerces CSV strings and treats empty cells as missing", () => {
    const r = validateRow(
      {
        ts: "2026-09-14T10:02:44Z", request_id: "r_8812", feature: "summarize", model: "model-large",
        input_tokens: "6120", output_tokens: "388", cached_input_tokens: "", attempt: "2",
        status: "ok", outcome: "success", retrieval_cost_usd: "0.0004", cost_usd: "", latency_ms: "",
      },
      2,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.input_tokens).toBe(6120);
    expect(r.row.attempt).toBe(2);
    expect(r.row.retrieval_cost_usd).toBeCloseTo(0.0004);
    expect(r.row.cached_input_tokens).toBeUndefined();
    expect(r.row.cost_usd).toBeUndefined();
  });

  it.each([
    [{ ...base, feature: undefined }, 'missing required field "feature"'],
    [{ ...base, input_tokens: "" }, 'missing required field "input_tokens"'],
    [{ ...base, ts: "yesterday" }, 'invalid ts "yesterday"'],
    [{ ...base, status: "200" }, 'invalid status "200"'],
    [{ ...base, outcome: "meh" }, 'invalid outcome "meh"'],
    [{ ...base, output_tokens: -1 }, '"output_tokens" must be a non-negative integer'],
    [{ ...base, input_tokens: 1.5 }, '"input_tokens" must be a non-negative integer'],
    [{ ...base, attempt: 0 }, '"attempt" must be >= 1'],
    [{ ...base, cached_input_tokens: 9999 }, '"cached_input_tokens" cannot exceed "input_tokens"'],
    [{ ...base, cost_usd: "abc" }, '"cost_usd" must be a non-negative number'],
  ])("rejects %o", (raw, message) => {
    const r = validateRow(raw as Record<string, unknown>, 7);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.line).toBe(7);
    expect(r.error.message).toContain(message);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run tests/validate.test.ts`
Expected: FAIL, cannot resolve `../src/load/validate.js`.

- [ ] **Step 4: Implement** `src/load/validate.ts`

```ts
import type { CallStatus, Outcome, RowError, TraceRow } from "../types.js";

export type ValidateResult = { ok: true; row: TraceRow } | { ok: false; error: RowError };

const STATUSES: readonly string[] = ["ok", "error", "timeout"];
const OUTCOMES: readonly string[] = ["success", "failure"];
const REQUIRED_STRINGS = ["ts", "request_id", "feature", "model", "status"] as const;
const INT_KEYS = ["input_tokens", "output_tokens", "cached_input_tokens", "attempt", "latency_ms"] as const;
const REQUIRED_INTS: readonly string[] = ["input_tokens", "output_tokens"];
const FLOAT_KEYS = ["retrieval_cost_usd", "cost_usd"] as const;

type IntKey = (typeof INT_KEYS)[number];
type FloatKey = (typeof FLOAT_KEYS)[number];

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** undefined = missing, NaN = present but not a finite number. */
function toNumber(v: unknown): number | undefined {
  if (isMissing(v)) return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

export function validateRow(raw: Record<string, unknown>, line: number): ValidateResult {
  const fail = (message: string): ValidateResult => ({ ok: false, error: { line, message } });

  for (const key of REQUIRED_STRINGS) {
    if (isMissing(raw[key])) return fail(`missing required field "${key}"`);
  }

  const ts = String(raw.ts);
  const tsMs = Date.parse(ts);
  if (Number.isNaN(tsMs)) return fail(`invalid ts "${ts}"`);

  const status = String(raw.status);
  if (!STATUSES.includes(status)) return fail(`invalid status "${status}" (expected ok | error | timeout)`);

  let outcome: Outcome | undefined;
  if (!isMissing(raw.outcome)) {
    const o = String(raw.outcome);
    if (!OUTCOMES.includes(o)) return fail(`invalid outcome "${o}" (expected success | failure)`);
    outcome = o as Outcome;
  }

  const ints: Partial<Record<IntKey, number>> = {};
  for (const key of INT_KEYS) {
    const n = toNumber(raw[key]);
    if (n === undefined) {
      if (REQUIRED_INTS.includes(key)) return fail(`missing required field "${key}"`);
      continue;
    }
    if (!Number.isInteger(n) || n < 0) return fail(`"${key}" must be a non-negative integer`);
    ints[key] = n;
  }
  const inputTokens = ints.input_tokens as number;
  if (ints.attempt !== undefined && ints.attempt < 1) return fail(`"attempt" must be >= 1`);
  if (ints.cached_input_tokens !== undefined && ints.cached_input_tokens > inputTokens) {
    return fail(`"cached_input_tokens" cannot exceed "input_tokens"`);
  }

  const floats: Partial<Record<FloatKey, number>> = {};
  for (const key of FLOAT_KEYS) {
    const n = toNumber(raw[key]);
    if (n === undefined) continue;
    if (Number.isNaN(n) || n < 0) return fail(`"${key}" must be a non-negative number`);
    floats[key] = n;
  }

  return {
    ok: true,
    row: {
      ts,
      tsMs,
      request_id: String(raw.request_id),
      feature: String(raw.feature),
      model: String(raw.model),
      input_tokens: inputTokens,
      output_tokens: ints.output_tokens as number,
      cached_input_tokens: ints.cached_input_tokens,
      attempt: ints.attempt,
      status: status as CallStatus,
      outcome,
      retrieval_cost_usd: floats.retrieval_cost_usd,
      cost_usd: floats.cost_usd,
      latency_ms: ints.latency_ms,
      line,
    },
  };
}
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npx vitest run tests/validate.test.ts && npm run typecheck`
Expected: all cases pass. (`toEqual` ignores `undefined` properties, so the first case matches.)

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/load/validate.ts tests/validate.test.ts
git commit -m "feat: validate trace rows against the README schema"
```

---

### Task 3: JSONL/CSV parsing and `loadTrace`

**Files:**
- Create: `src/load/parse.ts`, `src/load/loadTrace.ts`, `tests/fixtures/mini.jsonl`, `tests/fixtures/mini.csv`
- Test: `tests/loadTrace.test.ts`

**Interfaces:**
- Consumes: `validateRow`, `TraceRow`, `RowError`, `LoadedTrace` (Task 2)
- Produces:
  - `interface RawRecord { line: number; raw: Record<string, unknown> }`
  - `parseJsonl(text: string): { records: RawRecord[]; errors: RowError[] }`
  - `parseCsv(text: string): { records: RawRecord[]; errors: RowError[] }`. Throws on structurally malformed CSV.
  - `class TraceLoadError extends Error`
  - `loadTrace(path: string): LoadedTrace`. Picks the parser from the extension (`.jsonl`/`.ndjson`/`.csv`). Throws `TraceLoadError` if the file is unreadable, the extension is unsupported, the CSV is malformed, or there are zero valid rows.
  - The fixture `tests/fixtures/mini.jsonl` is reused by Tasks 13–15 and 17. **Do not change its numbers.**

- [ ] **Step 1: Create the shared fixture** `tests/fixtures/mini.jsonl`

These numbers are designed so that the summarize totals are easy to check by hand. `cost_usd` pins the costs:
r1 = timeout($1) + retry ok success($1); r2 = ok success($2); r3 = ok **failure**($1); r4 = error($0.5) + error($0.5) with **no outcome** and no `attempt`.
classify: c1 has 1M input / 100k output tokens on model-large (priced from the table = $4.50). c2 uses an **unknown model**.
Span: 2026-09-01 → 2026-09-16 = **15 days**.

```
{"ts":"2026-09-01T00:00:00Z","request_id":"r1","feature":"summarize","model":"model-large","input_tokens":1000,"output_tokens":100,"status":"timeout","attempt":1,"cost_usd":1}
{"ts":"2026-09-01T00:01:00Z","request_id":"r1","feature":"summarize","model":"model-large","input_tokens":1000,"output_tokens":100,"status":"ok","attempt":2,"outcome":"success","cost_usd":1}
{"ts":"2026-09-05T00:00:00Z","request_id":"r2","feature":"summarize","model":"model-large","input_tokens":2000,"output_tokens":100,"status":"ok","outcome":"success","cost_usd":2}
{"ts":"2026-09-08T00:00:00Z","request_id":"r3","feature":"summarize","model":"model-large","input_tokens":1000,"output_tokens":100,"status":"ok","outcome":"failure","cost_usd":1}
{"ts":"2026-09-10T00:00:00Z","request_id":"r4","feature":"summarize","model":"model-large","input_tokens":500,"output_tokens":50,"status":"error","cost_usd":0.5}
{"ts":"2026-09-10T00:00:30Z","request_id":"r4","feature":"summarize","model":"model-large","input_tokens":500,"output_tokens":50,"status":"error","cost_usd":0.5}
{"ts":"2026-09-12T00:00:00Z","request_id":"c1","feature":"classify","model":"model-large","input_tokens":1000000,"output_tokens":100000,"status":"ok","outcome":"success","latency_ms":2310}
{"ts":"2026-09-16T00:00:00Z","request_id":"c2","feature":"classify","model":"model-mystery","input_tokens":10,"output_tokens":1,"status":"ok","outcome":"success"}
```

- [ ] **Step 2: Create** `tests/fixtures/mini.csv` (header + 2 valid rows + 1 invalid row on line 4)

```
ts,request_id,feature,model,input_tokens,output_tokens,cached_input_tokens,attempt,status,outcome,retrieval_cost_usd,cost_usd,latency_ms
2026-09-14T10:02:11Z,r_8812,summarize,model-large,6120,410,,1,timeout,,,,30000
2026-09-14T10:02:44Z,r_8812,summarize,model-large,6120,388,,2,ok,success,0.0004,,1840
2026-09-14T10:03:00Z,r_9000,summarize,model-large,abc,388,,1,ok,success,,,
```

- [ ] **Step 3: Write the failing tests** `tests/loadTrace.test.ts`

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTrace, TraceLoadError } from "../src/load/loadTrace.js";
import { parseJsonl } from "../src/load/parse.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const tmpFile = (name: string, text: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "cpo-")), name);
  writeFileSync(path, text);
  return path;
};

describe("parseJsonl", () => {
  it("skips blank lines and reports bad JSON with its line number", () => {
    const { records, errors } = parseJsonl('{"a":1}\n\nnot json\n[1,2]\n');
    expect(records).toEqual([{ line: 1, raw: { a: 1 } }]);
    expect(errors).toEqual([
      { line: 3, message: "invalid JSON" },
      { line: 4, message: "expected a JSON object" },
    ]);
  });
});

describe("loadTrace", () => {
  it("loads the JSONL fixture", () => {
    const t = loadTrace(fixture("mini.jsonl"));
    expect(t.rows).toHaveLength(8);
    expect(t.errors).toEqual([]);
    expect(t.rows[0]?.request_id).toBe("r1");
  });

  it("loads CSV, keeps valid rows and reports invalid ones by line", () => {
    const t = loadTrace(fixture("mini.csv"));
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]?.retrieval_cost_usd).toBeCloseTo(0.0004);
    expect(t.errors).toEqual([{ line: 4, message: '"input_tokens" must be a non-negative integer' }]);
  });

  it("throws TraceLoadError for a missing file", () => {
    expect(() => loadTrace("/nope/traces.jsonl")).toThrow(TraceLoadError);
  });

  it("throws TraceLoadError for an unsupported extension", () => {
    expect(() => loadTrace(tmpFile("t.txt", "x"))).toThrow(/Unsupported trace file extension ".txt"/);
  });

  it("throws TraceLoadError when no row is valid", () => {
    expect(() => loadTrace(tmpFile("t.jsonl", '{"ts":"bad"}\n'))).toThrow(/No valid rows/);
  });

  it("throws TraceLoadError for structurally broken CSV", () => {
    expect(() => loadTrace(tmpFile("t.csv", 'a,b\n"unclosed,2\n'))).toThrow(/Malformed CSV/);
  });
});
```

- [ ] **Step 4: Run them and confirm they fail**

Run: `npx vitest run tests/loadTrace.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement** `src/load/parse.ts`

```ts
import { parse } from "csv-parse/sync";
import type { RowError } from "../types.js";

export interface RawRecord {
  line: number;
  raw: Record<string, unknown>;
}

export interface ParseResult {
  records: RawRecord[];
  errors: RowError[];
}

export function parseJsonl(text: string): ParseResult {
  const records: RawRecord[] = [];
  const errors: RowError[] = [];
  text.split(/\r?\n/).forEach((src, i) => {
    const line = i + 1;
    if (src.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(src);
    } catch {
      errors.push({ line, message: "invalid JSON" });
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push({ line, message: "expected a JSON object" });
      return;
    }
    records.push({ line, raw: value as Record<string, unknown> });
  });
  return { records, errors };
}

/** Header row gives field names. Empty cells stay "" and validateRow treats them as missing. */
export function parseCsv(text: string): ParseResult {
  const rows = parse(text, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    info: true,
  }) as Array<{ record: Record<string, string>; info: { lines: number } }>;
  return { records: rows.map(({ record, info }) => ({ line: info.lines, raw: record })), errors: [] };
}
```

- [ ] **Step 6: Implement** `src/load/loadTrace.ts`

```ts
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { LoadedTrace, RowError, TraceRow } from "../types.js";
import { parseCsv, parseJsonl, type ParseResult } from "./parse.js";
import { validateRow } from "./validate.js";

export class TraceLoadError extends Error {}

export function loadTrace(path: string): LoadedTrace {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new TraceLoadError(`Cannot read trace file "${path}": ${(err as Error).message}`);
  }

  const ext = extname(path).toLowerCase();
  let parsed: ParseResult;
  if (ext === ".jsonl" || ext === ".ndjson") {
    parsed = parseJsonl(text);
  } else if (ext === ".csv") {
    try {
      parsed = parseCsv(text);
    } catch (err) {
      throw new TraceLoadError(`Malformed CSV in "${path}": ${(err as Error).message}`);
    }
  } else {
    throw new TraceLoadError(`Unsupported trace file extension "${ext}". Use .jsonl or .csv`);
  }

  const rows: TraceRow[] = [];
  const errors: RowError[] = [...parsed.errors];
  for (const { line, raw } of parsed.records) {
    const result = validateRow(raw, line);
    if (result.ok) rows.push(result.row);
    else errors.push(result.error);
  }

  if (rows.length === 0) {
    const first = errors[0];
    const detail = first ? ` First error: line ${first.line}: ${first.message}` : "";
    throw new TraceLoadError(`No valid rows in "${path}" (${errors.length} invalid).${detail}`);
  }
  return { rows, errors, source: path };
}
```

- [ ] **Step 7: Run tests and confirm they pass**

Run: `npx vitest run tests/loadTrace.test.ts && npm run typecheck`
Expected: PASS. If the CSV error line comes out as something other than 4, print `info` once and adjust the `line` mapping (`info.lines` is the line where the record ends; for single-line records that's its own line). Don't change the fixture.

- [ ] **Step 8: Commit**

```bash
git add src/load tests/loadTrace.test.ts tests/fixtures
git commit -m "feat: load JSONL and CSV traces with per-line validation errors"
```

---

### Task 4: Pricing table and per-call cost

**Files:**
- Create: `src/pricing.ts`, `data/pricing.json`, `tests/fixtures/pricing.json`, `tests/helpers.ts`
- Test: `tests/pricing.test.ts`

**Interfaces:**
- Consumes: `TraceRow` (Task 2)
- Produces:
  - `interface ModelPrice { input: number; cached_input?: number; output: number }` (USD per 1M tokens)
  - `interface PricingTable { as_of: string; models: Record<string, ModelPrice> }`
  - `class PricingLoadError extends Error`
  - `loadPricing(path: string): PricingTable`. Validated with zod.
  - `tokenCost(row: Pick<TraceRow, "input_tokens" | "output_tokens" | "cached_input_tokens">, price: ModelPrice): number` (USD; decisions D1, D2)
  - `interface PricedCall extends TraceRow { tokenCostUsd: number; retrievalCostUsd: number; totalCostUsd: number; priced: boolean }`
  - `priceCall(row: TraceRow, pricing: PricingTable): PricedCall` (decisions D3, D11)
  - `tests/helpers.ts`: `makeRow(overrides?: Partial<TraceRow>): TraceRow`

- [ ] **Step 1: Create the bundled table** `data/pricing.json`

```json
{
  "as_of": "2026-10-01",
  "models": {
    "model-large": { "input": 3.0, "cached_input": 0.3, "output": 15.0 },
    "model-medium": { "input": 0.8, "cached_input": 0.08, "output": 4.0 },
    "model-small": { "input": 0.25, "cached_input": 0.03, "output": 1.25 }
  }
}
```

- [ ] **Step 2: Create the test fixture** `tests/fixtures/pricing.json`

```json
{
  "as_of": "2026-10-01",
  "models": {
    "model-large": { "input": 3.0, "cached_input": 0.3, "output": 15.0 },
    "model-small": { "input": 0.25, "cached_input": 0.03, "output": 1.25 }
  }
}
```

- [ ] **Step 3: Create** `tests/helpers.ts`

```ts
import type { TraceRow } from "../src/types.js";

export function makeRow(overrides: Partial<TraceRow> = {}): TraceRow {
  const ts = overrides.ts ?? "2026-09-01T00:00:00Z";
  return {
    ts,
    tsMs: Date.parse(ts),
    request_id: "r1",
    feature: "summarize",
    model: "model-large",
    input_tokens: 1000,
    output_tokens: 100,
    status: "ok",
    line: 1,
    ...overrides,
  };
}
```

- [ ] **Step 4: Write the failing tests** `tests/pricing.test.ts`

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPricing, PricingLoadError, priceCall, tokenCost } from "../src/pricing.js";
import { makeRow } from "./helpers.js";

const pricing = loadPricing(fileURLToPath(new URL("./fixtures/pricing.json", import.meta.url)));
const large = pricing.models["model-large"]!;

describe("loadPricing", () => {
  it("loads as_of and models", () => {
    expect(pricing.as_of).toBe("2026-10-01");
    expect(Object.keys(pricing.models)).toEqual(["model-large", "model-small"]);
  });

  it("rejects a table with a negative price", () => {
    const dir = mkdtempSync(join(tmpdir(), "cpo-"));
    const path = join(dir, "p.json");
    writeFileSync(path, JSON.stringify({ as_of: "x", models: { m: { input: -1, output: 1 } } }));
    expect(() => loadPricing(path)).toThrow(PricingLoadError);
  });

  it("rejects a missing file", () => {
    expect(() => loadPricing("/nope/pricing.json")).toThrow(PricingLoadError);
  });
});

describe("tokenCost", () => {
  it("prices uncached input + output per 1M tokens", () => {
    // 6120*3 + 410*15 = 24510 → $0.02451
    expect(tokenCost({ input_tokens: 6120, output_tokens: 410 }, large)).toBeCloseTo(0.02451, 10);
  });

  it("bills cached tokens at the cached rate; input_tokens includes cached (D1)", () => {
    // 600*3 + 400*0.3 + 100*15 = 3420 → $0.00342
    expect(tokenCost({ input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100 }, large)).toBeCloseTo(0.00342, 10);
  });

  it("falls back to the input rate when the model has no cached price (D2)", () => {
    expect(tokenCost({ input_tokens: 1000, cached_input_tokens: 400, output_tokens: 0 }, { input: 1, output: 2 })).toBeCloseTo(0.001, 10);
  });
});

describe("priceCall", () => {
  it("adds retrieval cost to token cost", () => {
    const c = priceCall(makeRow({ input_tokens: 6120, output_tokens: 410, retrieval_cost_usd: 0.0004 }), pricing);
    expect(c.priced).toBe(true);
    expect(c.tokenCostUsd).toBeCloseTo(0.02451, 10);
    expect(c.retrievalCostUsd).toBeCloseTo(0.0004, 10);
    expect(c.totalCostUsd).toBeCloseTo(0.02491, 10);
  });

  it("cost_usd overrides token cost but retrieval still adds (D3)", () => {
    const c = priceCall(makeRow({ cost_usd: 1, retrieval_cost_usd: 0.5, model: "unknown-model" }), pricing);
    expect(c).toMatchObject({ tokenCostUsd: 1, retrievalCostUsd: 0.5, totalCostUsd: 1.5, priced: true });
  });

  it("flags unknown models instead of silently pricing them (D11)", () => {
    const c = priceCall(makeRow({ model: "model-mystery", retrieval_cost_usd: 0.1 }), pricing);
    expect(c).toMatchObject({ tokenCostUsd: 0, totalCostUsd: 0.1, priced: false });
  });
});
```

- [ ] **Step 5: Run them and confirm they fail**

Run: `npx vitest run tests/pricing.test.ts`
Expected: FAIL, cannot resolve `../src/pricing.js`.

- [ ] **Step 6: Implement** `src/pricing.ts`

```ts
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
```

- [ ] **Step 7: Run tests and confirm they pass**

Run: `npx vitest run tests/pricing.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pricing.ts data/pricing.json tests/fixtures/pricing.json tests/helpers.ts tests/pricing.test.ts
git commit -m "feat: pricing table loader and per-call cost (tokens, cache, retrieval, overrides)"
```

---

## Phase 2 · Analysis core

### Task 5: Dataset (attempt numbering) and request grouping

**Files:**
- Create: `src/dataset.ts`, `src/analysis/requests.ts`
- Modify: `tests/helpers.ts` (add `makeCall`)
- Test: `tests/dataset.test.ts`, `tests/requests.test.ts`

**Interfaces:**
- Consumes: `PricedCall`, `priceCall`, `PricingTable` (Task 4); `LoadedTrace`, `RowError` (Task 2); `loadTrace` (Task 3)
- Produces:
  - `type AttemptedCall = PricedCall & { attemptN: number }`
  - `annotateAttempts(calls: PricedCall[]): AttemptedCall[]`. Keeps input order (D6).
  - `interface Dataset { calls: AttemptedCall[]; pricing: PricingTable; skippedRows: RowError[]; traceSource: string }`
  - `buildDataset(trace: LoadedTrace, pricing: PricingTable): Dataset`
  - `interface RequestGroup { request_id: string; feature: string; calls: AttemptedCall[]; success: boolean; outcomeInferred: boolean; totalCostUsd: number }` (`calls` sorted by `attemptN`)
  - `groupRequests(calls: AttemptedCall[]): RequestGroup[]`. Keeps first-seen request order.
  - `tests/helpers.ts`: `makeCall(overrides?: Partial<AttemptedCall>): AttemptedCall` (default cost $1, attemptN 1, priced)

- [ ] **Step 1: Add `makeCall` to** `tests/helpers.ts` (append below `makeRow`, and add the import at the top)

```ts
import type { AttemptedCall } from "../src/dataset.js";

/** A priced, attempt-numbered call. totalCostUsd defaults to $1, all of it token cost. */
export function makeCall(overrides: Partial<AttemptedCall> = {}): AttemptedCall {
  const cost = overrides.totalCostUsd ?? 1;
  return {
    ...makeRow(overrides),
    tokenCostUsd: cost,
    retrievalCostUsd: 0,
    totalCostUsd: cost,
    priced: true,
    attemptN: 1,
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests** `tests/dataset.test.ts`

```ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { annotateAttempts, buildDataset } from "../src/dataset.js";
import { loadTrace } from "../src/load/loadTrace.js";
import { loadPricing, priceCall } from "../src/pricing.js";
import { makeRow } from "./helpers.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const pricing = loadPricing(fixture("pricing.json"));
const priced = (...rows: ReturnType<typeof makeRow>[]) => rows.map((r) => priceCall(r, pricing));

describe("annotateAttempts", () => {
  it("numbers attempts by timestamp within a request, keeping input order", () => {
    const out = annotateAttempts(
      priced(
        makeRow({ request_id: "a", ts: "2026-09-01T00:00:10Z", line: 1 }),
        makeRow({ request_id: "a", ts: "2026-09-01T00:00:00Z", line: 2 }),
        makeRow({ request_id: "b", ts: "2026-09-01T00:00:05Z", line: 3 }),
      ),
    );
    expect(out.map((c) => [c.line, c.attemptN])).toEqual([[1, 2], [2, 1], [3, 1]]);
  });

  it("uses file order to break timestamp ties", () => {
    const out = annotateAttempts(priced(makeRow({ request_id: "a", line: 1 }), makeRow({ request_id: "a", line: 2 })));
    expect(out.map((c) => c.attemptN)).toEqual([1, 2]);
  });

  it("keeps an explicit attempt field", () => {
    const out = annotateAttempts(priced(makeRow({ request_id: "a", attempt: 3 })));
    expect(out[0]?.attemptN).toBe(3);
  });
});

describe("buildDataset", () => {
  it("prices and numbers the mini fixture", () => {
    const ds = buildDataset(loadTrace(fixture("mini.jsonl")), pricing);
    expect(ds.calls).toHaveLength(8);
    expect(ds.calls.filter((c) => c.request_id === "r4").map((c) => c.attemptN)).toEqual([1, 2]);
    expect(ds.calls.find((c) => c.request_id === "c1")?.totalCostUsd).toBeCloseTo(4.5, 10);
    expect(ds.calls.find((c) => c.request_id === "c2")?.priced).toBe(false);
    expect(ds.skippedRows).toEqual([]);
    expect(ds.traceSource).toBe(fixture("mini.jsonl"));
  });
});
```

- [ ] **Step 3: Write the failing tests** `tests/requests.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { groupRequests } from "../src/analysis/requests.js";
import { makeCall } from "./helpers.js";

describe("groupRequests", () => {
  it("groups calls by request_id, sorts by attempt, and sums cost", () => {
    const [g] = groupRequests([
      makeCall({ request_id: "a", attemptN: 2, status: "ok", outcome: "success", totalCostUsd: 2 }),
      makeCall({ request_id: "a", attemptN: 1, status: "timeout", totalCostUsd: 1 }),
    ]);
    expect(g?.calls.map((c) => c.attemptN)).toEqual([1, 2]);
    expect(g?.totalCostUsd).toBe(3);
    expect(g).toMatchObject({ request_id: "a", success: true, outcomeInferred: false });
  });

  it("uses outcome on the final attempt when present", () => {
    const [g] = groupRequests([makeCall({ request_id: "a", status: "ok", outcome: "failure" })]);
    expect(g).toMatchObject({ success: false, outcomeInferred: false });
  });

  it("falls back to final status ok when outcome is missing, and flags it", () => {
    const groups = groupRequests([
      makeCall({ request_id: "ok", status: "ok" }),
      makeCall({ request_id: "bad", status: "error" }),
    ]);
    expect(groups.map((g) => [g.request_id, g.success, g.outcomeInferred])).toEqual([
      ["ok", true, true],
      ["bad", false, true],
    ]);
  });
});
```

- [ ] **Step 4: Run them and confirm they fail**

Run: `npx vitest run tests/dataset.test.ts tests/requests.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement** `src/dataset.ts`

```ts
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
```

- [ ] **Step 6: Implement** `src/analysis/requests.ts`

```ts
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
```

- [ ] **Step 7: Run tests and confirm they pass**

Run: `npx vitest run tests/dataset.test.ts tests/requests.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/dataset.ts src/analysis/requests.ts tests/helpers.ts tests/dataset.test.ts tests/requests.test.ts
git commit -m "feat: attempt numbering and request grouping with outcome fallback"
```

---

### Task 6: Filters and reporting period

**Files:**
- Create: `src/analysis/filters.ts`, `src/analysis/period.ts`
- Test: `tests/filters.test.ts`, `tests/period.test.ts`

**Interfaces:**
- Consumes: `TraceRow` (Task 2)
- Produces:
  - `interface Filters { feature?: string; model?: string; from?: string; to?: string }`
  - `class FilterError extends Error`. Its message is shown to the user as a tool error.
  - `applyFilters<T extends TraceRow>(calls: T[], filters: Filters): T[]` (D7)
  - `inferPeriodDays(calls: Pick<TraceRow, "tsMs">[]): number`. Minimum 1.
  - `resolvePeriodDays(calls: TraceRow[], filters: Filters, override?: number): number` (D8)
  - `monthly(costUsd: number, periodDays: number): number` = `costUsd × 30 / periodDays`

- [ ] **Step 1: Write the failing tests** `tests/filters.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { applyFilters, FilterError } from "../src/analysis/filters.js";
import { makeRow } from "./helpers.js";

const rows = [
  makeRow({ request_id: "a", feature: "summarize", model: "model-large", ts: "2026-09-14T00:00:00Z" }),
  makeRow({ request_id: "b", feature: "classify", model: "model-small", ts: "2026-09-14T23:59:59Z" }),
  makeRow({ request_id: "c", feature: "summarize", model: "model-small", ts: "2026-09-15T00:00:00Z" }),
];
const ids = (f: Parameters<typeof applyFilters>[1]) => applyFilters(rows, f).map((r) => r.request_id);

describe("applyFilters", () => {
  it("returns everything with no filters", () => expect(ids({})).toEqual(["a", "b", "c"]));
  it("filters by feature", () => expect(ids({ feature: "summarize" })).toEqual(["a", "c"]));
  it("filters by model", () => expect(ids({ model: "model-small" })).toEqual(["b", "c"]));
  it("treats from as inclusive", () => expect(ids({ from: "2026-09-14T23:59:59Z" })).toEqual(["b", "c"]));
  it("treats a datetime to as exclusive", () => expect(ids({ to: "2026-09-14T23:59:59Z" })).toEqual(["a"]));
  it("treats a date-only to as covering that whole day", () => expect(ids({ to: "2026-09-14" })).toEqual(["a", "b"]));
  it("combines filters", () => expect(ids({ feature: "summarize", from: "2026-09-15" })).toEqual(["c"]));

  it("rejects an invalid date", () => {
    expect(() => ids({ from: "last tuesday" })).toThrow(FilterError);
    expect(() => ids({ from: "last tuesday" })).toThrow(/Invalid "from" date/);
  });

  it("rejects from after to", () => {
    expect(() => ids({ from: "2026-09-20", to: "2026-09-10" })).toThrow(/"from" must be before "to"/);
  });
});
```

- [ ] **Step 2: Write the failing tests** `tests/period.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { inferPeriodDays, monthly, resolvePeriodDays } from "../src/analysis/period.js";
import { makeRow } from "./helpers.js";

const rows = [
  makeRow({ feature: "summarize", ts: "2026-09-01T00:00:00Z" }),
  makeRow({ feature: "classify", ts: "2026-09-16T00:00:00Z" }),
];

describe("period", () => {
  it("infers the span between first and last call in days", () => expect(inferPeriodDays(rows)).toBe(15));
  it("never returns less than 1 day", () => expect(inferPeriodDays([rows[0]!])).toBe(1));
  it("returns 1 for no calls", () => expect(inferPeriodDays([])).toBe(1));

  it("ignores feature/model filters but honours from/to (D8)", () => {
    expect(resolvePeriodDays(rows, { feature: "summarize" })).toBe(15);
    expect(resolvePeriodDays(rows, { to: "2026-09-02" })).toBe(1);
  });

  it("uses an explicit override", () => expect(resolvePeriodDays(rows, {}, 30)).toBe(30));
  it("scales cost to a 30-day month", () => expect(monthly(6, 15)).toBe(12));
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `npx vitest run tests/filters.test.ts tests/period.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement** `src/analysis/filters.ts`

```ts
import type { TraceRow } from "../types.js";

export interface Filters {
  feature?: string;
  model?: string;
  /** Inclusive. ISO 8601 date or datetime. */
  from?: string;
  /** Exclusive. A date-only value covers that whole day. */
  to?: string;
}

export class FilterError extends Error {}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseBound(value: string, name: "from" | "to"): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new FilterError(`Invalid "${name}" date "${value}". Use ISO 8601, e.g. 2026-09-14 or 2026-09-14T10:00:00Z`);
  }
  return name === "to" && DATE_ONLY.test(value) ? ms + DAY_MS : ms;
}

export function applyFilters<T extends TraceRow>(calls: T[], filters: Filters): T[] {
  const fromMs = filters.from ? parseBound(filters.from, "from") : -Infinity;
  const toMs = filters.to ? parseBound(filters.to, "to") : Infinity;
  if (fromMs >= toMs) throw new FilterError(`"from" must be before "to"`);
  return calls.filter(
    (c) =>
      (!filters.feature || c.feature === filters.feature) &&
      (!filters.model || c.model === filters.model) &&
      c.tsMs >= fromMs &&
      c.tsMs < toMs,
  );
}
```

- [ ] **Step 5: Implement** `src/analysis/period.ts`

```ts
import type { TraceRow } from "../types.js";
import { applyFilters, type Filters } from "./filters.js";

const DAY_MS = 86_400_000;

export function inferPeriodDays(calls: Pick<TraceRow, "tsMs">[]): number {
  if (calls.length === 0) return 1;
  let min = Infinity;
  let max = -Infinity;
  for (const c of calls) {
    if (c.tsMs < min) min = c.tsMs;
    if (c.tsMs > max) max = c.tsMs;
  }
  return Math.max(1, (max - min) / DAY_MS);
}

/** D8: the window is set by from/to only, so a sparse feature isn't over-projected. */
export function resolvePeriodDays(calls: TraceRow[], filters: Filters, override?: number): number {
  return override ?? inferPeriodDays(applyFilters(calls, { from: filters.from, to: filters.to }));
}

export function monthly(costUsd: number, periodDays: number): number {
  return costUsd * (30 / periodDays);
}
```

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npx vitest run tests/filters.test.ts tests/period.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/analysis/filters.ts src/analysis/period.ts tests/filters.test.ts tests/period.test.ts
git commit -m "feat: feature/model/date filters and monthly projection period"
```

---

### Task 7: `cost_per_outcome` computation

**Files:**
- Create: `src/analysis/costPerOutcome.ts`
- Test: `tests/costPerOutcome.test.ts`

**Interfaces:**
- Consumes: `RequestGroup`, `groupRequests` (Task 5); `makeCall` (test helper)
- Produces:
  - `interface CostPerOutcomeResult { requests: number; calls: number; retryCalls: number; successes: number; successRate: number; totalCostUsd: number; costPerRequestUsd: number; costPerSuccessUsd: number | null; overheadPct: number | null; retryOverheadUsd: number; failedRequestsUsd: number; outcomeInferredRequests: number; unpricedCalls: number }`. All percentages/rates are fractions (0.19 = 19%). `null` = no successful requests.
  - `costPerOutcome(groups: RequestGroup[]): CostPerOutcomeResult` (formulas from Global Constraints, D5)

- [ ] **Step 1: Write the failing test** `tests/costPerOutcome.test.ts`

This is the same scenario as the summarize rows in `mini.jsonl`, so you can check it by hand:
total $6 · 4 requests · 2 successes → $1.50/request, $3.00/success, +100% overhead. Retry overhead $1 (r1 attempt 2). Failed requests $2 (r3 $1 + r4 $1).

```ts
import { describe, expect, it } from "vitest";
import { costPerOutcome } from "../src/analysis/costPerOutcome.js";
import { groupRequests } from "../src/analysis/requests.js";
import { makeCall } from "./helpers.js";

const calls = [
  makeCall({ request_id: "r1", attemptN: 1, status: "timeout", totalCostUsd: 1 }),
  makeCall({ request_id: "r1", attemptN: 2, status: "ok", outcome: "success", totalCostUsd: 1 }),
  makeCall({ request_id: "r2", attemptN: 1, status: "ok", outcome: "success", totalCostUsd: 2 }),
  makeCall({ request_id: "r3", attemptN: 1, status: "ok", outcome: "failure", totalCostUsd: 1 }),
  makeCall({ request_id: "r4", attemptN: 1, status: "error", totalCostUsd: 0.5 }),
  makeCall({ request_id: "r4", attemptN: 2, status: "error", totalCostUsd: 0.5, priced: false }),
];

describe("costPerOutcome", () => {
  it("spreads all spend over successful requests", () => {
    const r = costPerOutcome(groupRequests(calls));
    expect(r).toMatchObject({
      requests: 4,
      calls: 6,
      retryCalls: 2,
      successes: 2,
      successRate: 0.5,
      totalCostUsd: 6,
      costPerRequestUsd: 1.5,
      costPerSuccessUsd: 3,
      overheadPct: 1,
      retryOverheadUsd: 1,
      failedRequestsUsd: 2,
      outcomeInferredRequests: 1,
      unpricedCalls: 1,
    });
  });

  it("returns null cost per success when nothing succeeded", () => {
    const r = costPerOutcome(groupRequests([makeCall({ request_id: "x", status: "error" })]));
    expect(r.costPerSuccessUsd).toBeNull();
    expect(r.overheadPct).toBeNull();
    expect(r.failedRequestsUsd).toBe(1);
  });

  it("handles an empty input without dividing by zero", () => {
    const r = costPerOutcome([]);
    expect(r).toMatchObject({ requests: 0, costPerRequestUsd: 0, successRate: 0, costPerSuccessUsd: null });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/costPerOutcome.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/analysis/costPerOutcome.ts`

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/costPerOutcome.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/costPerOutcome.ts tests/costPerOutcome.test.ts
git commit -m "feat: cost per request vs cost per success with retry/failure overhead"
```

---

### Task 8: `cost_by_feature` computation

**Files:**
- Create: `src/analysis/costByFeature.ts`
- Test: `tests/costByFeature.test.ts`

**Interfaces:**
- Consumes: `AttemptedCall` (Task 5); `monthly` (Task 6)
- Produces:
  - `interface LayerCosts { tokens: number; retrieval: number; retries: number; total: number }` (D4: tokens + retrieval + retries = total)
  - `interface ModelBreakdown extends LayerCosts { model: string; calls: number }`
  - `interface FeatureCost extends LayerCosts { feature: string; calls: number; requests: number; share: number; monthlyUsd: number; models: ModelBreakdown[] }`
  - `interface CostByFeatureResult { features: FeatureCost[]; totalCostUsd: number; monthlyTotalUsd: number; periodDays: number }`. Features and models are sorted by `total` descending.
  - `costByFeature(calls: AttemptedCall[], periodDays: number): CostByFeatureResult`

- [ ] **Step 1: Write the failing test** `tests/costByFeature.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { costByFeature } from "../src/analysis/costByFeature.js";
import { makeCall } from "./helpers.js";

const calls = [
  // summarize: first attempt with retrieval, then a retry → tokens 1, retrieval 0.5, retries 2
  makeCall({ request_id: "s1", feature: "summarize", model: "model-large", attemptN: 1, tokenCostUsd: 1, retrievalCostUsd: 0.5, totalCostUsd: 1.5 }),
  makeCall({ request_id: "s1", feature: "summarize", model: "model-large", attemptN: 2, tokenCostUsd: 1.5, retrievalCostUsd: 0.5, totalCostUsd: 2 }),
  makeCall({ request_id: "s2", feature: "summarize", model: "model-small", attemptN: 1, totalCostUsd: 0.5 }),
  makeCall({ request_id: "c1", feature: "classify", model: "model-small", attemptN: 1, totalCostUsd: 1 }),
];

describe("costByFeature", () => {
  const r = costByFeature(calls, 15);

  it("sorts features by spend and computes share and monthly", () => {
    expect(r.features.map((f) => f.feature)).toEqual(["summarize", "classify"]);
    expect(r.totalCostUsd).toBe(5);
    expect(r.monthlyTotalUsd).toBe(10);
    expect(r.features[0]).toMatchObject({ calls: 3, requests: 2, total: 4, share: 0.8, monthlyUsd: 8 });
  });

  it("splits cost into non-overlapping layers (D4)", () => {
    expect(r.features[0]).toMatchObject({ tokens: 1.5, retrieval: 0.5, retries: 2, total: 4 });
  });

  it("breaks each feature down by model, sorted by spend", () => {
    expect(r.features[0]?.models.map((m) => [m.model, m.calls, m.total])).toEqual([
      ["model-large", 2, 3.5],
      ["model-small", 1, 0.5],
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/costByFeature.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/analysis/costByFeature.ts`

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/costByFeature.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/costByFeature.ts tests/costByFeature.test.ts
git commit -m "feat: spend per feature split by model and cost layer"
```

---

### Task 9: `top_expensive_calls` computation

**Files:**
- Create: `src/analysis/topExpensiveCalls.ts`
- Test: `tests/topExpensiveCalls.test.ts`

**Interfaces:**
- Consumes: `AttemptedCall` (Task 5)
- Produces:
  - `interface ExpensiveCall { call: AttemptedCall; share: number; inputVsMedian: number | null }` (`inputVsMedian` = this call's input tokens ÷ median input tokens. This is the "bloat" signal.)
  - `interface TopExpensiveResult { calls: ExpensiveCall[]; totalCostUsd: number; totalCalls: number; medianInputTokens: number; topShare: number }`
  - `median(values: number[]): number`
  - `topExpensiveCalls(calls: AttemptedCall[], n: number): TopExpensiveResult`. Sorted by cost desc, earlier `ts` first on ties.

- [ ] **Step 1: Write the failing test** `tests/topExpensiveCalls.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { median, topExpensiveCalls } from "../src/analysis/topExpensiveCalls.js";
import { makeCall } from "./helpers.js";

const calls = [
  makeCall({ request_id: "a", totalCostUsd: 5, input_tokens: 4000 }),
  makeCall({ request_id: "b", totalCostUsd: 1, input_tokens: 1000, ts: "2026-09-02T00:00:00Z" }),
  makeCall({ request_id: "c", totalCostUsd: 3, input_tokens: 2000 }),
  makeCall({ request_id: "d", totalCostUsd: 1, input_tokens: 1000, ts: "2026-09-01T00:00:00Z" }),
];

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4000, 1000, 2000, 1000])).toBe(1500);
    expect(median([])).toBe(0);
  });
});

describe("topExpensiveCalls", () => {
  it("returns the N most expensive calls with spend share", () => {
    const r = topExpensiveCalls(calls, 2);
    expect(r.calls.map((e) => e.call.request_id)).toEqual(["a", "c"]);
    expect(r.calls.map((e) => e.share)).toEqual([0.5, 0.3]);
    expect(r.topShare).toBeCloseTo(0.8, 10);
    expect(r).toMatchObject({ totalCostUsd: 10, totalCalls: 4, medianInputTokens: 1500 });
  });

  it("compares input size against the median", () => {
    expect(topExpensiveCalls(calls, 1).calls[0]?.inputVsMedian).toBeCloseTo(4000 / 1500, 10);
  });

  it("breaks ties by earlier timestamp and caps at the number of calls", () => {
    const r = topExpensiveCalls(calls, 99);
    expect(r.calls.map((e) => e.call.request_id)).toEqual(["a", "c", "d", "b"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/topExpensiveCalls.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/analysis/topExpensiveCalls.ts`

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/topExpensiveCalls.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/topExpensiveCalls.ts tests/topExpensiveCalls.test.ts
git commit -m "feat: top N expensive calls with spend share and input-size bloat ratio"
```

---

### Task 10: `model_swap_whatif` computation

**Files:**
- Create: `src/analysis/modelSwapWhatif.ts`
- Test: `tests/modelSwapWhatif.test.ts`

**Interfaces:**
- Consumes: `AttemptedCall`, `annotateAttempts` (Task 5); `PricingTable`, `tokenCost`, `priceCall`, `loadPricing` (Task 4); `monthly` (Task 6)
- Produces:
  - `interface SwapInput { feature: string; targetModel: string; sourceModel?: string; periodDays: number }`
  - `interface SwapResult { feature: string; sourceModels: string[]; targetModel: string; calls: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; currentCostUsd: number; projectedCostUsd: number; savingsUsd: number; savingsPct: number; currentMonthlyUsd: number; projectedMonthlyUsd: number; monthlySavingsUsd: number; periodDays: number; excludedUnpricedCalls: number; overriddenCostCalls: number; asOf: string }`
  - `class WhatifError extends Error`. Its message is shown to the user as a tool error.
  - `modelSwapWhatif(calls: AttemptedCall[], pricing: PricingTable, input: SwapInput): SwapResult` (D10)

- [ ] **Step 1: Write the failing test** `tests/modelSwapWhatif.test.ts`

c1 on model-large: 1M in × $3 + 100k out × $15 = $4.50. On model-small: 1M × $0.25 + 100k × $1.25 = $0.375. Savings are $4.125 (91.7%). Over 15 days that scales ×2 to $8.25/month.

```ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { modelSwapWhatif, WhatifError } from "../src/analysis/modelSwapWhatif.js";
import { annotateAttempts } from "../src/dataset.js";
import { loadPricing, priceCall } from "../src/pricing.js";
import { makeRow } from "./helpers.js";

const pricing = loadPricing(fileURLToPath(new URL("./fixtures/pricing.json", import.meta.url)));
const calls = annotateAttempts(
  [
    makeRow({ request_id: "c1", feature: "classify", model: "model-large", input_tokens: 1_000_000, output_tokens: 100_000 }),
    makeRow({ request_id: "c2", feature: "classify", model: "model-mystery", input_tokens: 10, output_tokens: 1 }),
    makeRow({ request_id: "c3", feature: "classify", model: "model-small", input_tokens: 500, output_tokens: 5 }),
    makeRow({ request_id: "s1", feature: "summarize", model: "model-large", input_tokens: 9_999, output_tokens: 999 }),
  ].map((r) => priceCall(r, pricing)),
);
const base = { feature: "classify", targetModel: "model-small", periodDays: 15 };

describe("modelSwapWhatif", () => {
  it("reprices the feature's non-target calls against the target model", () => {
    const r = modelSwapWhatif(calls, pricing, base);
    expect(r).toMatchObject({
      feature: "classify",
      sourceModels: ["model-large"],
      targetModel: "model-small",
      calls: 1,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      excludedUnpricedCalls: 1,
      overriddenCostCalls: 0,
      asOf: "2026-10-01",
    });
    expect(r.currentCostUsd).toBeCloseTo(4.5, 10);
    expect(r.projectedCostUsd).toBeCloseTo(0.375, 10);
    expect(r.savingsUsd).toBeCloseTo(4.125, 10);
    expect(r.savingsPct).toBeCloseTo(4.125 / 4.5, 10);
    expect(r.monthlySavingsUsd).toBeCloseTo(8.25, 10);
  });

  it("restricts to an explicit source model", () => {
    const r = modelSwapWhatif(calls, pricing, { ...base, sourceModel: "model-large" });
    expect(r).toMatchObject({ calls: 1, excludedUnpricedCalls: 0 });
  });

  it.each([
    [{ ...base, targetModel: "model-nope" }, /Unknown target model "model-nope".*model-large, model-small/],
    [{ ...base, feature: "nope" }, /No calls for feature "nope"/],
    [{ ...base, sourceModel: "model-small" }, /Source and target model are the same/],
    [{ ...base, sourceModel: "model-mystery" }, /missing from the pricing table/],
  ])("rejects %o", (input, message) => {
    expect(() => modelSwapWhatif(calls, pricing, input)).toThrow(WhatifError);
    expect(() => modelSwapWhatif(calls, pricing, input)).toThrow(message);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/modelSwapWhatif.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/analysis/modelSwapWhatif.ts`

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/modelSwapWhatif.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/modelSwapWhatif.ts tests/modelSwapWhatif.test.ts
git commit -m "feat: model swap what-if with monthly savings projection"
```

---

## Phase 3 · Presentation

### Task 11: Report formatting

Reports are plain text, built to be read by both the model and the human. Each report follows the same layout: a header line (scope + period), a rule, aligned label/value rows, one plain-English takeaway, and `Note:` lines for data-quality caveats. The README's `cost_per_outcome` example is the style reference.

**Files:**
- Create: `src/format.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: `CostPerOutcomeResult` (T7), `CostByFeatureResult` (T8), `TopExpensiveResult` (T9), `SwapResult` (T10)
- Produces:
  - `interface ReportContext { scope: string; periodDays: number; currency: string; notes: string[] }`
  - `money(n: number, currency: string, digits?: number): string`. USD → `$4.32`. Other currencies → `4.32 EUR` (label only, D: no FX). If digits = 2 and |n| < 0.01, it switches to 4 decimals so small numbers don't show as `$0.00`.
  - `pct(fraction: number, digits?: number): string` (`0.839, 1` → `83.9%`), `signedPct(fraction: number): string` (`0.19` → `+19%`)
  - `renderCostPerOutcome(r, ctx): string`, `renderCostByFeature(r, ctx): string`, `renderTopExpensive(r, ctx): string`, `renderSwap(r, ctx): string`

- [ ] **Step 1: Write the failing tests** `tests/format.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { CostPerOutcomeResult } from "../src/analysis/costPerOutcome.js";
import type { SwapResult } from "../src/analysis/modelSwapWhatif.js";
import { money, pct, renderCostPerOutcome, renderSwap, signedPct } from "../src/format.js";

const ctx = { scope: "Feature: summarize", periodDays: 15, currency: "USD", notes: ["Pricing as of 2026-10-01."] };

describe("number helpers", () => {
  it("formats money", () => {
    expect(money(4.32, "USD")).toBe("$4.32");
    expect(money(0.024, "USD", 4)).toBe("$0.0240");
    expect(money(0.0012, "USD")).toBe("$0.0012");
    expect(money(-1, "USD")).toBe("-$1.00");
    expect(money(4.32, "EUR")).toBe("4.32 EUR");
  });

  it("formats percentages", () => {
    expect(pct(0.839, 1)).toBe("83.9%");
    expect(pct(0.14)).toBe("14%");
    expect(signedPct(0.19)).toBe("+19%");
    expect(signedPct(-0.05)).toBe("-5%");
  });
});

describe("renderCostPerOutcome", () => {
  const result: CostPerOutcomeResult = {
    requests: 4, calls: 6, retryCalls: 2, successes: 2, successRate: 0.5, totalCostUsd: 6,
    costPerRequestUsd: 1.5, costPerSuccessUsd: 3, overheadPct: 1, retryOverheadUsd: 1, failedRequestsUsd: 2,
    outcomeInferredRequests: 1, unpricedCalls: 0,
  };
  const text = renderCostPerOutcome(result, ctx);

  it("matches the README layout", () => {
    expect(text).toContain("Feature: summarize   (15 days)");
    expect(text).toMatch(/Calls \(incl\. retries\)\s+6\s+\+2 retry calls/);
    expect(text).toMatch(/Cost per success\s+\$3\.0000\s+← \+100% vs per-request/);
    expect(text).toMatch(/Retries\s+\$1\.00\s+17%/);
    expect(text).toMatch(/Failed requests\s+\$2\.00\s+33%/);
  });

  it("explains inferred outcomes and appends notes", () => {
    expect(text).toContain("Note: 1 of 4 requests had no outcome field");
    expect(text).toContain("Note: Pricing as of 2026-10-01.");
  });

  it("handles no successes", () => {
    const none = renderCostPerOutcome({ ...result, successes: 0, costPerSuccessUsd: null, overheadPct: null }, ctx);
    expect(none).toContain("n/a (no successful requests)");
  });
});

describe("renderSwap", () => {
  const swap: SwapResult = {
    feature: "classify", sourceModels: ["model-large"], targetModel: "model-small", calls: 1,
    inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000, currentCostUsd: 4.5,
    projectedCostUsd: 0.375, savingsUsd: 4.125, savingsPct: 0.9167, currentMonthlyUsd: 9,
    projectedMonthlyUsd: 0.75, monthlySavingsUsd: 8.25, periodDays: 15, excludedUnpricedCalls: 1,
    overriddenCostCalls: 0, asOf: "2026-10-01",
  };
  const text = renderSwap(swap, { ...ctx, scope: "Feature: classify", notes: [] });

  it("shows the projection and monthly savings", () => {
    expect(text).toContain("model-large → model-small");
    expect(text).toMatch(/Estimated savings\s+\$4\.13 \(92%\)\s+→ \$8\.25 \/ month/);
    expect(text).toContain("1 calls on unpriced models were left out");
  });

  it("always carries the quality caveat", () => {
    expect(text).toContain("worth testing");
    expect(text).toContain("±10–20%");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/format.ts`

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/format.test.ts && npm run typecheck`
Expected: PASS. If a regex misses only because of column padding, change the padding in `row()`, not the test. The tests use `\s+` on purpose.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "feat: plain-text reports for all four tools"
```

---

## Phase 4 · MCP server + CLI

### Task 12: Configuration (flags > env > defaults)

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_TRACE_PATH`, `DEFAULT_PRICING_PATH`: absolute paths to the bundled `data/` files. They resolve correctly from both `src/` (tsx/vitest) and `dist/` (built), because both sit one level below `data/`.
  - `interface Config { tracePath: string; pricingPath: string; periodDays?: number; currency: string; usingSampleTrace: boolean; usingBundledPricing: boolean }`
  - `type Cli = { kind: "run"; config: Config } | { kind: "help" } | { kind: "version" }`
  - `class ConfigError extends Error`
  - `HELP: string`
  - `resolveConfig(argv: string[], env: NodeJS.ProcessEnv, cwd?: string): Cli`. Relative paths resolve against `cwd`, and a leading `~/` expands to the home directory.

- [ ] **Step 1: Write the failing tests** `tests/config.test.ts`

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_PRICING_PATH, DEFAULT_TRACE_PATH, resolveConfig } from "../src/config.js";

const run = (argv: string[], env: NodeJS.ProcessEnv = {}) => {
  const cli = resolveConfig(argv, env, "/work");
  if (cli.kind !== "run") throw new Error(`expected run, got ${cli.kind}`);
  return cli.config;
};

describe("resolveConfig", () => {
  it("defaults to the bundled sample trace and pricing", () => {
    expect(run([])).toEqual({
      tracePath: DEFAULT_TRACE_PATH,
      pricingPath: DEFAULT_PRICING_PATH,
      periodDays: undefined,
      currency: "USD",
      usingSampleTrace: true,
      usingBundledPricing: true,
    });
    expect(DEFAULT_TRACE_PATH).toMatch(/data[\\/]sample-traces\.jsonl$/);
  });

  it("reads env vars and resolves relative paths against cwd", () => {
    const c = run([], { COST_TRACE_PATH: "./traces.jsonl", COST_PRICING_PATH: "/abs/p.json", COST_PERIOD_DAYS: "30", COST_CURRENCY: "eur" });
    expect(c).toMatchObject({
      tracePath: join("/work", "traces.jsonl"),
      pricingPath: "/abs/p.json",
      periodDays: 30,
      currency: "EUR",
      usingSampleTrace: false,
      usingBundledPricing: false,
    });
  });

  it("lets flags beat env vars", () => {
    const c = run(["--trace", "/a.csv", "--period-days", "7"], { COST_TRACE_PATH: "/b.jsonl", COST_PERIOD_DAYS: "30" });
    expect(c).toMatchObject({ tracePath: "/a.csv", periodDays: 7 });
  });

  it("treats an empty env var as unset", () => {
    expect(run([], { COST_TRACE_PATH: "" }).usingSampleTrace).toBe(true);
  });

  it("expands ~/", () => {
    expect(run(["--trace", "~/t.jsonl"]).tracePath).toBe(join(homedir(), "t.jsonl"));
  });

  it("rejects a non-positive period", () => {
    expect(() => run(["--period-days", "0"])).toThrow(ConfigError);
    expect(() => run([], { COST_PERIOD_DAYS: "abc" })).toThrow(/Invalid period days "abc"/);
  });

  it("rejects unknown flags", () => {
    expect(() => run(["--nope"])).toThrow(ConfigError);
  });

  it("recognises --help and --version", () => {
    expect(resolveConfig(["--help"], {}).kind).toBe("help");
    expect(resolveConfig(["-v"], {}).kind).toBe("version");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/config.ts`

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/config.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: resolve trace/pricing/period config from flags and env"
```

---

### Task 13: MCP server with the four tools

**Files:**
- Create: `src/server.ts`
- Test: `tests/server.test.ts` (real MCP client ↔ server over `InMemoryTransport`)

**Interfaces:**
- Consumes: everything from Tasks 5–11 (`Dataset`, `applyFilters`, `FilterError`, `resolvePeriodDays`, `groupRequests`, `costPerOutcome`, `costByFeature`, `topExpensiveCalls`, `modelSwapWhatif`, `WhatifError`, the `render*` functions, `ReportContext`) and `VERSION` (Task 1)
- Produces:
  - `interface ServerSettings { periodDaysOverride?: number; currency: string; usingSampleTrace: boolean; pricingSource: string }` (`pricingSource` = `"bundled"` or the path)
  - `createServer(dataset: Dataset, settings: ServerSettings): McpServer`
  - Tool contract: every tool returns one `text` content block. User mistakes (bad date, unknown target model) come back as `isError: true` with a helpful message. They are never thrown. An empty selection is **not** an error: the reply lists the features, models, and time range that do exist.

- [ ] **Step 1: Write the failing integration test** `tests/server.test.ts`

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDataset } from "../src/dataset.js";
import { loadTrace } from "../src/load/loadTrace.js";
import { loadPricing } from "../src/pricing.js";
import { createServer, type ServerSettings } from "../src/server.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function connect(settings: Partial<ServerSettings> = {}) {
  const dataset = buildDataset(loadTrace(fixture("mini.jsonl")), loadPricing(fixture("pricing.json")));
  const server = createServer(dataset, { currency: "USD", usingSampleTrace: false, pricingSource: "bundled", ...settings });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return { text: content[0]?.text ?? "", isError: res.isError === true };
}

describe("MCP server", () => {
  it("lists exactly the four read-only tools", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["cost_by_feature", "cost_per_outcome", "model_swap_whatif", "top_expensive_calls"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("cost_per_outcome answers 'what does a successful summary cost?'", async () => {
    const { text, isError } = await call(await connect(), "cost_per_outcome", { feature: "summarize" });
    expect(isError).toBe(false);
    expect(text).toContain("Feature: summarize   (15 days)");
    expect(text).toMatch(/Cost per success\s+\$3\.0000\s+← \+100% vs per-request/);
    expect(text).toContain("1 of 4 requests had no outcome field");
  });

  it("cost_by_feature ranks features and reports unpriced models", async () => {
    const { text } = await call(await connect(), "cost_by_feature");
    expect(text.indexOf("summarize")).toBeLessThan(text.indexOf("classify"));
    expect(text).toContain("model-mystery (1 calls)");
    expect(text).toContain("Pricing as of 2026-10-01");
  });

  it("top_expensive_calls honours n", async () => {
    const { text } = await call(await connect(), "top_expensive_calls", { n: 1 });
    expect(text).toContain("request c1");
    expect(text).not.toContain("#2");
  });

  it("model_swap_whatif projects monthly savings with the caveat", async () => {
    const { text } = await call(await connect(), "model_swap_whatif", { feature: "classify", target_model: "model-small" });
    expect(text).toMatch(/→ \$8\.25 \/ month/);
    expect(text).toContain("worth testing");
  });

  it("uses the period override for monthly figures", async () => {
    const { text } = await call(await connect({ periodDaysOverride: 30 }), "cost_by_feature");
    expect(text).toContain("30 days");
    expect(text).toMatch(/Total\s+\$10\.50\s+100%\s+\$10\.50/);
  });

  it("returns tool errors for user mistakes", async () => {
    const client = await connect();
    const swap = await call(client, "model_swap_whatif", { feature: "classify", target_model: "model-nope" });
    expect(swap).toMatchObject({ isError: true });
    expect(swap.text).toMatch(/Unknown target model "model-nope"/);
    const date = await call(client, "cost_by_feature", { from: "last tuesday" });
    expect(date).toMatchObject({ isError: true });
    expect(date.text).toMatch(/Invalid "from" date/);
  });

  it("explains an empty selection instead of erroring", async () => {
    const { text, isError } = await call(await connect(), "cost_per_outcome", { feature: "nope" });
    expect(isError).toBe(false);
    expect(text).toContain("No calls match");
    expect(text).toContain("Features in this trace: classify, summarize");
  });

  it("flags the bundled sample trace", async () => {
    const { text } = await call(await connect({ usingSampleTrace: true }), "cost_by_feature");
    expect(text).toContain("bundled synthetic sample");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL, cannot resolve `../src/server.js`.

- [ ] **Step 3: Implement** `src/server.ts`

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/server.test.ts && npm test && npm run typecheck`
Expected: PASS, and the full unit suite is still green.
If `registerTool` or `annotations` won't typecheck, the installed SDK major version differs. Run `npm ls @modelcontextprotocol/sdk`, open `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`, and adapt the call signature only. Don't change the tool names, schemas, or output.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: register the four read-only MCP tools"
```

---

### Task 14: Bundled synthetic sample trace

The "try it without your own data" path is the first thing new users see, so the sample has to look realistic: ~500 calls, 4 features, 3 models, plausible retry/timeout/failure rates, some cached tokens, some retrieval cost, and a few missing `outcome` fields. It must be fully deterministic (seeded) and committed to the repo.

**Files:**
- Create: `scripts/sample.ts` (pure generator), `scripts/gen-sample.ts` (writes the file), `data/sample-traces.jsonl` (generated)
- Test: `tests/sample.test.ts`

**Interfaces:**
- Consumes: `validateRow` (T2), `loadTrace` (T3), `loadPricing` (T4), `buildDataset` (T5), `groupRequests` (T5), `costPerOutcome` (T7)
- Produces: `generateSample(seed?: number): SampleRow[]`, `mulberry32(seed: number): () => number`. `data/sample-traces.jsonl` is the default trace (`DEFAULT_TRACE_PATH`, Task 12).

- [ ] **Step 1: Write the failing test** `tests/sample.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSample } from "../scripts/sample.js";
import { costPerOutcome } from "../src/analysis/costPerOutcome.js";
import { groupRequests } from "../src/analysis/requests.js";
import { buildDataset } from "../src/dataset.js";
import { loadTrace } from "../src/load/loadTrace.js";
import { validateRow } from "../src/load/validate.js";
import { loadPricing } from "../src/pricing.js";

const dataFile = (name: string) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const rows = generateSample(42);

describe("generateSample", () => {
  it("is deterministic for a seed", () => {
    expect(generateSample(42)).toEqual(rows);
    expect(generateSample(7)).not.toEqual(rows);
  });

  it("has ~500 calls across 4 features and 3 models", () => {
    expect(rows.length).toBeGreaterThanOrEqual(450);
    expect(rows.length).toBeLessThanOrEqual(560);
    expect(new Set(rows.map((r) => r.feature)).size).toBe(4);
    expect(new Set(rows.map((r) => r.model)).size).toBe(3);
  });

  it("produces only schema-valid rows", () => {
    rows.forEach((r, i) => expect(validateRow({ ...r }, i + 1).ok).toBe(true));
  });

  it("exercises retries, timeouts, failures, caching, retrieval and missing outcomes", () => {
    expect(rows.some((r) => r.attempt > 1)).toBe(true);
    expect(rows.some((r) => r.status === "timeout")).toBe(true);
    expect(rows.some((r) => r.outcome === "failure")).toBe(true);
    expect(rows.some((r) => (r.cached_input_tokens ?? 0) > 0)).toBe(true);
    expect(rows.some((r) => (r.retrieval_cost_usd ?? 0) > 0)).toBe(true);
    const finals = rows.filter((r) => r.status === "ok" || r.attempt === 3);
    expect(finals.some((r) => r.outcome === undefined)).toBe(true);
  });

  it("is committed: data/sample-traces.jsonl equals generateSample(42)", () => {
    const committed = readFileSync(dataFile("sample-traces.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(committed).toEqual(JSON.parse(JSON.stringify(rows)));
  });

  it("tells a realistic story: success overhead between 3% and 50%", () => {
    const ds = buildDataset(loadTrace(dataFile("sample-traces.jsonl")), loadPricing(dataFile("pricing.json")));
    const r = costPerOutcome(groupRequests(ds.calls));
    expect(r.unpricedCalls).toBe(0);
    expect(r.overheadPct).toBeGreaterThan(0.03);
    expect(r.overheadPct).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/sample.test.ts`
Expected: FAIL, cannot resolve `../scripts/sample.js`.

- [ ] **Step 3: Implement** `scripts/sample.ts`

```ts
export interface SampleRow {
  ts: string;
  request_id: string;
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  attempt: number;
  status: "ok" | "error" | "timeout";
  outcome?: "success" | "failure";
  retrieval_cost_usd?: number;
  latency_ms: number;
}

interface FeatureProfile {
  feature: string;
  model: string;
  requests: number;
  inputMean: number;
  outputMean: number;
  cachedShare: number;
  retrievalUsd: number;
  timeoutRate: number;
  errorRate: number;
  /** Chance an ok final attempt still isn't usable. */
  failureRate: number;
}

const PROFILES: FeatureProfile[] = [
  { feature: "summarize", model: "model-large", requests: 120, inputMean: 6000, outputMean: 400, cachedShare: 0, retrievalUsd: 0.0004, timeoutRate: 0.1, errorRate: 0.04, failureRate: 0.1 },
  { feature: "chat", model: "model-large", requests: 100, inputMean: 2500, outputMean: 300, cachedShare: 0.6, retrievalUsd: 0.0002, timeoutRate: 0.04, errorRate: 0.03, failureRate: 0.06 },
  { feature: "classify", model: "model-medium", requests: 130, inputMean: 800, outputMean: 20, cachedShare: 0.3, retrievalUsd: 0, timeoutRate: 0.01, errorRate: 0.03, failureRate: 0.04 },
  { feature: "extract", model: "model-small", requests: 80, inputMean: 3000, outputMean: 600, cachedShare: 0, retrievalUsd: 0, timeoutRate: 0.03, errorRate: 0.08, failureRate: 0.15 },
];

const MAX_ATTEMPTS = 3;
const MISSING_OUTCOME_RATE = 0.05;
const WINDOW_MS = 30 * 86_400_000;

/** Small seeded PRNG so the sample is byte-for-byte reproducible. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSample(seed = 42): SampleRow[] {
  const rand = mulberry32(seed);
  const jitter = (mean: number) => Math.max(1, Math.round(mean * (0.5 + rand())));
  const start = Date.parse("2026-09-01T00:00:00Z");
  const rows: SampleRow[] = [];
  let nextId = 1000;

  for (const p of PROFILES) {
    for (let i = 0; i < p.requests; i++) {
      const request_id = `r_${nextId++}`;
      const input = jitter(p.inputMean);
      let t = start + Math.floor(rand() * WINDOW_MS);

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const roll = rand();
        const status = roll < p.timeoutRate ? "timeout" : roll < p.timeoutRate + p.errorRate ? "error" : "ok";
        const output = status === "ok" ? jitter(p.outputMean) : status === "timeout" ? jitter(p.outputMean / 2) : 0;
        const row: SampleRow = {
          ts: new Date(t).toISOString(),
          request_id,
          feature: p.feature,
          model: p.model,
          input_tokens: input,
          output_tokens: output,
          attempt,
          status,
          latency_ms: status === "timeout" ? 30_000 : Math.round(300 + output * 15 * (0.8 + rand() * 0.4)),
        };
        if (p.cachedShare > 0) row.cached_input_tokens = Math.round(input * p.cachedShare);
        if (p.retrievalUsd > 0) row.retrieval_cost_usd = p.retrievalUsd;

        const final = status === "ok" || attempt === MAX_ATTEMPTS;
        if (final && rand() >= MISSING_OUTCOME_RATE) {
          row.outcome = status === "ok" && rand() >= p.failureRate ? "success" : "failure";
        }
        rows.push(row);
        if (final) break;
        t += 5_000 + Math.floor(rand() * 35_000);
      }
    }
  }
  return rows.sort((a, b) => a.ts.localeCompare(b.ts));
}
```

- [ ] **Step 4: Implement** `scripts/gen-sample.ts`

```ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateSample } from "./sample.js";

const out = fileURLToPath(new URL("../data/sample-traces.jsonl", import.meta.url));
const rows = generateSample();
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`Wrote ${rows.length} calls to ${out}`);
```

- [ ] **Step 5: Generate the data file**

Run: `npm run gen:sample`
Expected: `Wrote 4xx–5xx calls to …/data/sample-traces.jsonl`

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npx vitest run tests/sample.test.ts && npm test && npm run typecheck`
Expected: PASS. If the call count or overhead lands outside its range, tune `requests` or the rates in `PROFILES` (not the test), regenerate, and rerun.

- [ ] **Step 7: Commit**

```bash
git add scripts data/sample-traces.jsonl tests/sample.test.ts
git commit -m "feat: deterministic synthetic sample trace for zero-config demo"
```

---

### Task 15: CLI entry point and end-to-end stdio tests

**Files:**
- Create: `src/index.ts`
- Test: `tests/e2e/stdio.test.ts` (runs against the **built** `dist/index.js`)

**Interfaces:**
- Consumes: `resolveConfig`, `HELP`, `ConfigError` (T12); `loadTrace`, `TraceLoadError` (T3); `loadPricing`, `PricingLoadError` (T4); `buildDataset` (T5); `createServer` (T13); `VERSION` (T1)
- Produces: the executable `dist/index.js` (`bin: cost-per-outcome-mcp`). Exit code 0 for help/version, 1 with a one-line `cost-per-outcome-mcp: <message>` on stderr for config/load errors. The server logs to **stderr only**.

- [ ] **Step 1: Write the failing e2e test** `tests/e2e/stdio.test.ts`

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(args: string[]) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, ...args], cwd: root, stderr: "pipe" });
  client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

const textOf = (res: Awaited<ReturnType<Client["callTool"]>>) => (res.content as Array<{ text: string }>)[0]?.text ?? "";

describe("dist/index.js over stdio", () => {
  it("serves the fixture trace given by flags", async () => {
    const c = await connect(["--trace", fixture("mini.jsonl"), "--pricing", fixture("pricing.json")]);
    const { tools } = await c.listTools();
    expect(tools).toHaveLength(4);
    const text = textOf(await c.callTool({ name: "cost_per_outcome", arguments: { feature: "summarize" } }));
    expect(text).toMatch(/Cost per success\s+\$3\.0000/);
  });

  it("falls back to the bundled sample with zero config", async () => {
    const c = await connect([]);
    const text = textOf(await c.callTool({ name: "cost_by_feature", arguments: {} }));
    expect(text).toContain("summarize");
    expect(text).toContain("bundled synthetic sample");
  });

  it("prints version and help without starting the server", () => {
    const v = spawnSync(process.execPath, [entry, "--version"], { encoding: "utf8" });
    expect(v.status).toBe(0);
    expect(v.stdout.trim()).toBe("0.1.0");
    const h = spawnSync(process.execPath, [entry, "--help"], { encoding: "utf8" });
    expect(h.stdout).toContain("--trace <file>");
  });

  it("fails fast with a readable error for a missing trace", () => {
    const r = spawnSync(process.execPath, [entry, "--trace", "/nope/traces.jsonl"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^cost-per-outcome-mcp: Cannot read trace file "\/nope\/traces\.jsonl"/);
    expect(r.stdout).toBe("");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test:e2e`
Expected: FAIL. Either the build errors because `src/index.ts` is missing or `dist/index.js` doesn't exist.

- [ ] **Step 3: Implement** `src/index.ts`

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, HELP, resolveConfig } from "./config.js";
import { buildDataset } from "./dataset.js";
import { loadTrace, TraceLoadError } from "./load/loadTrace.js";
import { loadPricing, PricingLoadError } from "./pricing.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

// stdout carries MCP JSON-RPC. Everything human-readable goes to stderr.
async function main(): Promise<void> {
  const cli = resolveConfig(process.argv.slice(2), process.env);
  if (cli.kind === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (cli.kind === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const { config } = cli;
  const dataset = buildDataset(loadTrace(config.tracePath), loadPricing(config.pricingPath));
  const server = createServer(dataset, {
    periodDaysOverride: config.periodDays,
    currency: config.currency,
    usingSampleTrace: config.usingSampleTrace,
    pricingSource: config.usingBundledPricing ? "bundled" : config.pricingPath,
  });
  await server.connect(new StdioServerTransport());

  const source = config.usingSampleTrace ? "bundled sample" : config.tracePath;
  const skipped = dataset.skippedRows.length ? `, ${dataset.skippedRows.length} invalid rows skipped` : "";
  console.error(`cost-per-outcome-mcp ${VERSION}: ${dataset.calls.length} calls from ${source}${skipped}`);
}

main().catch((err: unknown) => {
  const expected = err instanceof ConfigError || err instanceof TraceLoadError || err instanceof PricingLoadError;
  const message = err instanceof Error ? (expected ? err.message : (err.stack ?? err.message)) : String(err);
  console.error(`cost-per-outcome-mcp: ${message}`);
  process.exit(1);
});
```

- [ ] **Step 4: Run e2e and confirm it passes**

Run: `npm run test:e2e`
Expected: build succeeds and all 4 e2e tests pass.

- [ ] **Step 5: Manual check with the MCP Inspector**

Run: `npx @modelcontextprotocol/inspector node dist/index.js`
Check in the browser UI: 4 tools are listed with titles and descriptions. Call each one with `{}`, then `cost_per_outcome` with `{"feature":"summarize"}`, then `model_swap_whatif` with `{"feature":"summarize","target_model":"model-small"}`. Every report renders, nothing shows up in the server's stdout panel except JSON-RPC, and the sample-trace note is present.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/e2e
git commit -m "feat: CLI entry over stdio with fail-fast config and load errors"
```

---

## Phase 5 · Hardening

### Task 16: Read-only guard and CI

"Read-only by design" is a promise in the README. This task turns it into a failing test, so a future PR can't quietly add a network call, a file write, or a stray `console.log` that corrupts the stdio stream.

**Files:**
- Create: `tests/readonly.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `src/` tree and `package.json`
- Produces: a CI gate that runs typecheck, unit tests, e2e tests, and a pack dry-run on every push/PR.

- [ ] **Step 1: Write the guard test** `tests/readonly.test.ts`

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

const FORBIDDEN: Array<[RegExp, string]> = [
  [/["']node:(http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster)["']/, "network/process module"],
  [/\bfetch\s*\(/, "fetch()"],
  [/\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rmSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync)\b/, "file write"],
  [/console\.log\s*\(/, "console.log (stdout belongs to MCP; use console.error)"],
  [/API_KEY|apiKey|Authorization/i, "credential handling"],
];

describe("read-only by design", () => {
  const files = sourceFiles(srcDir);

  it("finds the source files", () => expect(files.length).toBeGreaterThan(10));

  it.each(FORBIDDEN)("src/ never uses %s", (pattern, label) => {
    const offenders = files.filter((f) => pattern.test(readFileSync(f, "utf8")));
    expect(offenders, `${label} found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps the runtime dependency budget to three packages", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@modelcontextprotocol/sdk", "csv-parse", "zod"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it passes, then prove it can fail**

Run: `npx vitest run tests/readonly.test.ts`
Expected: PASS.
Then temporarily add `console.log("x");` to `src/version.ts` and rerun. Expected: FAIL naming `src/version.ts`. Revert the line and rerun to get PASS again.

- [ ] **Step 3: Write** `.github/workflows/ci.yml`

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: node ${{ matrix.node }} · ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest]
        node: [20, 22, 24]
        include:
          - os: macos-latest
            node: 22
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:e2e
      - run: npm pack --dry-run
```

- [ ] **Step 4: Run the full local gate**

Run: `npm run typecheck && npm test && npm run test:e2e && npm pack --dry-run`
Expected: everything is green. The pack listing contains only `package.json`, `README.md`/`Readme.md`, `LICENSE` (once Task 17 adds it), `dist/**`, and `data/pricing.json` + `data/sample-traces.jsonl`. **No** `src/`, `tests/`, or `scripts/`.

- [ ] **Step 5: Commit**

```bash
git add tests/readonly.test.ts .github/workflows/ci.yml
git commit -m "test: enforce read-only guarantees; add CI matrix"
```

---

## Phase 6 · Launch

### Task 17: Docs, manual QA in real clients, and release

**Owner inputs needed before this task** (ask the project owner. Don't invent these): GitHub handle/repo URL, the name for the LICENSE copyright line, the "See the AI Cost Audit" link target, and the npm account that will publish.

**Files:**
- Rename: `Readme.md` → `README.md`
- Modify: `README.md`, `package.json` (repository/homepage/bugs/author)
- Create: `LICENSE`, `CHANGELOG.md`

- [ ] **Step 1: Fix the README structure**

```bash
git mv Readme.md README.md
```
Then edit `README.md`:
1. Remove the stray first line `hinglish`. It looks like a personal note, so confirm with the owner first.
2. Turn the flattened tables back into real markdown tables: **Tools** (Tool | Answers | Key output), **Configuration** (Env var / flag | Default | Purpose), **Trace schema** (Field | Type | Required | Notes), **How cost is calculated** layers (Layer | Source), and **Exporting traces** (Source | Quick path).
3. Wrap the command, JSON, JSONL, CSV, formula, and report examples in fenced code blocks with language tags (`bash`, `json`, `jsonl`, `csv`, `text`).
4. Replace `<your-handle>` with the real repo path (owner input).

- [ ] **Step 2: Document the calculation decisions**

Under "How cost is calculated", add a short **"Edge cases"** list with one line for each decision D1–D11 from this plan. Use the user-facing wording, for example:
- `input_tokens` includes `cached_input_tokens`; only the remainder is billed at the full input rate.
- Models without a `cached_input` price bill cached tokens at the input rate.
- `cost_usd` replaces token cost; `retrieval_cost_usd` is still added.
- `to` is exclusive; a plain date covers that whole day.
- Monthly figures use the trace window inside `from`/`to`, not per-feature activity.
- Invalid rows are skipped and reported, never silently dropped.

In the Cursor section, add: *"Relative paths resolve against the server's working directory, which depends on the client. Prefer an absolute path or `~/…`."*

- [ ] **Step 3: Replace the example output with real output from the bundled sample**

Run:
```bash
npm run build
node --input-type=module -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const c = new Client({ name: 'readme', version: '0' });
await c.connect(new StdioClientTransport({ command: 'node', args: ['dist/index.js'] }));
const r = await c.callTool({ name: 'cost_per_outcome', arguments: { feature: 'summarize' } });
console.log(r.content[0].text);
await c.close();
"
```
Paste the report into the README's `cost_per_outcome` example (dropping the `Note:` lines), and update the prose numbers below it ("Cost per request says … That N% …") to match. A user running the zero-config demo must see exactly what the README shows.

- [ ] **Step 4: LICENSE, CHANGELOG, package metadata**

`LICENSE`: standard MIT text with `Copyright (c) 2026 <owner name from inputs>`.

`CHANGELOG.md`:
```markdown
# Changelog

## 0.1.0 — first release

- Four read-only MCP tools: `cost_by_feature`, `cost_per_outcome`, `top_expensive_calls`, `model_swap_whatif`.
- JSONL and CSV traces; per-line validation with skipped-row reporting.
- Bundled pricing table (`as_of` 2026-10-01) and deterministic synthetic sample trace.
- Config via flags or env: `--trace`, `--pricing`, `--period-days`, `COST_CURRENCY`.
```

`package.json`: add `"author"`, `"repository": { "type": "git", "url": "git+https://github.com/<handle>/cost-per-outcome-mcp.git" }`, `"homepage"`, and `"bugs"`, using the owner inputs.

- [ ] **Step 5: Manual QA in Claude Desktop**

Link the local build so `npx` resolves it: `npm run build && npm link`. Then put the README's Claude Desktop config in `claude_desktop_config.json`, with `"command": "cost-per-outcome-mcp"`, `"args": []`, and **no** `COST_TRACE_PATH`. Restart Claude Desktop and check:

| Ask | Expected |
|-----|----------|
| "What does a successful summary cost us?" | Calls `cost_per_outcome` with `feature: "summarize"`; answer quotes cost per success and the overhead % |
| "Which feature burns the most on retries?" | Calls `cost_by_feature`; answer names the feature with the largest Retries column |
| "What do we save if classify moves to a smaller model?" | Calls `model_swap_whatif` (`feature: "classify"`, `target_model: "model-small"`); answer gives monthly savings **and** repeats the "worth testing" caveat |
| "Show me the 5 most expensive calls last week" | Calls `top_expensive_calls` with `n: 5` and a `from` date |
| "What does chat cost on 2026-13-45?" | Tool error about the invalid date; the model recovers and asks or fixes the date |

Then set `COST_TRACE_PATH` to an absolute path of `tests/fixtures/mini.csv`, restart, and confirm the skipped-row note shows up.

- [ ] **Step 6: Manual QA in Cursor**

Add the README's `.cursor/mcp.json` with an absolute `COST_TRACE_PATH`. In Cursor Settings → MCP, the server shows green with 4 tools. Ask the first three questions from Step 5 in Agent chat and check the same expectations.

- [ ] **Step 7: Final gate and pack check**

Run: `npm run typecheck && npm test && npm run test:e2e && npm pack --dry-run`
Expected: all green. The pack contains only `LICENSE`, `README.md`, `package.json`, `dist/**`, and `data/*`.
Then install from the tarball in a temp dir and run it the way users will:
```bash
npm pack
cd "$(mktemp -d)" && npm init -y >/dev/null && npm install /path/to/cost-per-outcome-mcp-0.1.0.tgz
npx cost-per-outcome-mcp --version   # → 0.1.0
npx cost-per-outcome-mcp --help
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: release-ready README, LICENSE, CHANGELOG, package metadata"
```

- [ ] **Step 9: Publish. Confirm with the owner first; this is public and irreversible.**

After explicit go-ahead:
```bash
npm publish --access public
git tag v0.1.0 && git push origin main --tags
```
Then create a GitHub release for `v0.1.0` with the CHANGELOG entry. Verify on a clean machine: `npx -y cost-per-outcome-mcp --version` prints `0.1.0`.

---

## Post-v0.1 backlog (from README "Next")

These are not part of this plan. Each gets its own spec and plan when it's picked up. The layered architecture leaves room for them:

| Item | Where it plugs in |
|------|-------------------|
| Langfuse / Helicone connectors | New readers in `src/load/` that output the same raw records → `validateRow` |
| Bedrock invocation logs from S3 | New reader. **Breaks "no network calls"**, so it needs an explicit opt-in flag and a README update |
| Prompt-cache hit rate per feature | New analysis over `cached_input_tokens / input_tokens` per feature + new tool |
| Context-bloat detector | Input-token trend per feature over time (weekly buckets) |
| `quality_adjusted_whatif` | `model_swap_whatif` + user-supplied eval pass rates → projected cost per success |

## Self-review: spec coverage

| README requirement | Task |
|--------------------|------|
| 4 tools with the stated questions/outputs | 7, 8, 9, 10, 11, 13 |
| Optional `feature`/`model`/`from`/`to` on all tools | 6, 13 |
| `cost_per_outcome` example layout incl. overhead breakdown | 7, 11 |
| `model_swap_whatif` caveats, observed volumes, 30-day scaling | 10, 11 |
| JSONL + CSV, schema, required fields, empty CSV cells = missing | 2, 3 |
| `request_id` groups retries; `attempt` defaults to order | 5 |
| `status` vs `outcome`, and the fallback stated in the output | 5, 11 |
| Three cost layers; formulas verbatim | 4, 7, 8 |
| Pricing table, `as_of`, override path, unknown models reported | 4, 13 |
| Env vars / flags and their defaults | 12, 15 |
| Bundled synthetic sample (~500 calls, 4 features, 3 models) | 14 |
| Read-only: no network, no writes, no credentials | 16 |
| `npm run build`, `dev`, `gen:sample`; inspector workflow | 1, 14, 15 |
| Claude Desktop + Cursor install instructions work | 17 |
| `npx -y cost-per-outcome-mcp` works | 15, 17 |
| Limitations stated honestly | 11 (caveat), 17 (README) |
