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
