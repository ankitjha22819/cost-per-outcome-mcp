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
