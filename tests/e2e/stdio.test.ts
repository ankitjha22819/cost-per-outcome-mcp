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
