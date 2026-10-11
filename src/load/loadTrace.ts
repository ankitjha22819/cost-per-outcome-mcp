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
