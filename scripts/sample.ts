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
