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
