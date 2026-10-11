import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateSample } from "./sample.js";

const out = fileURLToPath(new URL("../data/sample-traces.jsonl", import.meta.url));
const rows = generateSample();
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`Wrote ${rows.length} calls to ${out}`);
