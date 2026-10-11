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
