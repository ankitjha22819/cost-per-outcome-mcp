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
