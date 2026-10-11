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
