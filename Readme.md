hinglish

cost-per-outcome-mcp
Ask your LLM trace logs what a successful request actually costs.
A small, read-only MCP server. Point it at a JSONL or CSV export of your LLM calls, then ask Claude Desktop or Cursor cost questions in plain English:
"What does a successful summary cost us?"
"Which feature burns the most on retries?"
"What do we save if classify moves to a smaller model?"

npx -y cost-per-outcome-mcp --trace ./traces.jsonl
Why this exists
Most LLM cost dashboards show cost per request. That number lies.
A request that retried twice, timed out, or returned an answer nobody could use still cost money. The number that matters is cost per successful outcome: total spend divided by requests that actually did their job.
The gap between those two numbers is usually where the savings are. This server makes that gap visible on your own logs in about two minutes.
Tools
ToolAnswersKey outputcost_by_featureWhere is the money going?Spend per feature/endpoint, split by model and cost layercost_per_outcomeWhat does success cost?Cost per request vs cost per successful request, with retry and failure overheadtop_expensive_callsWhich calls are bloated?The N most expensive calls, with input token size and share of total spendmodel_swap_whatifWhat if we switch models?Estimated monthly savings for moving feature X from model A to model BAll four tools accept optional feature, model, from, and to filters.
cost_per_outcome — the one to run first
> What does a successful summary cost us?

Feature: summarize   (synthetic sample, 30 days)
─────────────────────────────────────────────────
Requests                 180
Calls (incl. retries)    214     +34 retry calls
Successful outcomes      151     83.9%
Total spend              $4.32

Cost per request         $0.0240
Cost per success         $0.0286   ← +19% vs per-request

Overhead breakdown
  Retries                $0.61   14%
  Failed requests        $0.69   16%
Cost per request says $0.024. What you actually pay for a summary that works is $0.0286. That 19% is spend with nothing to show for it.
model_swap_whatif
Uses observed token volumes for the feature, re-priced against the target model from the pricing table, then scaled to a 30-day month.
It estimates cost only. It does not know if the cheaper model is good enough for your task. Treat the output as "worth testing," not "safe to ship." Validate against your evals before switching.
Install
Claude Desktop
Add to claude_desktop_config.json:
{
  "mcpServers": {
    "cost-per-outcome": {
      "command": "npx",
      "args": ["-y", "cost-per-outcome-mcp"],
      "env": {
        "COST_TRACE_PATH": "/absolute/path/to/traces.jsonl"
      }
    }
  }
}
Restart Claude Desktop. The four tools show up under the 🔌 menu.
Cursor
Add to .cursor/mcp.json in your project (or ~/.cursor/mcp.json globally):
{
  "mcpServers": {
    "cost-per-outcome": {
      "command": "npx",
      "args": ["-y", "cost-per-outcome-mcp"],
      "env": {
        "COST_TRACE_PATH": "./traces.jsonl"
      }
    }
  }
}
Try it without your own data
Leave COST_TRACE_PATH unset. The server loads the bundled synthetic trace (~500 calls across 4 features, 3 models, with realistic retry and failure rates).
Configuration
Env var / flagDefaultPurposeCOST_TRACE_PATH / --tracebundled samplePath to .jsonl or .csv trace fileCOST_PRICING_PATH / --pricingbundled pricing.jsonOverride the pricing tableCOST_PERIOD_DAYS / --period-daysinferred from timestampsWindow used to project monthly figuresCOST_CURRENCYUSDDisplay only; no FX conversionTrace schema
One row per LLM call. Rows that share a request_id are one logical request (the original attempt plus its retries).
FieldTypeRequiredNotestsISO 8601 string✅Call start timerequest_idstring✅Groups retries into one requestfeaturestring✅Feature or endpoint, e.g. summarize, /api/chatmodelstring✅Must match a key in the pricing tableinput_tokensint✅output_tokensint✅cached_input_tokensintBilled at the cached rate if the model has oneattemptint1 = first try. Defaults to order within request_idstatusok | error | timeout✅Did the API call itself succeed?outcomesuccess | failureDid the request do its job? Set on the final attempt onlyretrieval_cost_usdfloatEmbedding / vector query cost attributed to this callcost_usdfloatIf present, overrides computed token costlatency_msintReported by top_expensive_callsstatus vs outcome: status: ok means the API returned 200. outcome: success means the result was usable (passed validation, parsed correctly, user didn't regenerate). If outcome is missing, the server falls back to "final attempt has status: ok" and says so in its output.
JSONL example
{"ts":"2026-09-14T10:02:11Z","request_id":"r_8812","feature":"summarize","model":"model-large","input_tokens":6120,"output_tokens":410,"status":"timeout","attempt":1}
{"ts":"2026-09-14T10:02:44Z","request_id":"r_8812","feature":"summarize","model":"model-large","input_tokens":6120,"output_tokens":388,"status":"ok","attempt":2,"outcome":"success","retrieval_cost_usd":0.0004}
CSV
Same field names as the header row. Empty cells are treated as missing.
ts,request_id,feature,model,input_tokens,output_tokens,cached_input_tokens,attempt,status,outcome,retrieval_cost_usd,cost_usd,latency_ms
How cost is calculated
Every call is split into the same three cost layers I use in audits:
LayerSourceTokensinput_tokens, cached_input_tokens, output_tokens × pricing tableRetrievalretrieval_cost_usd (0 if absent)RetriesFull cost of every call where attempt > 1Then:
cost_per_request = Σ cost(all calls) / count(distinct request_id)
cost_per_success = Σ cost(all calls) / count(request_id where outcome = success)
overhead_pct     = cost_per_success / cost_per_request − 1
The numerator is the same in both. Failed and retried spend is not dropped; it's spread across the requests that worked, because that's what you actually paid for them.
Pricing table
pricing.json is bundled and date-stamped. Prices are USD per 1M tokens.
{
  "as_of": "2026-10-01",
  "models": {
    "model-large": { "input": 3.00, "cached_input": 0.30, "output": 15.00 },
    "model-small": { "input": 0.25, "cached_input": 0.03, "output": 1.25 }
  }
}
Provider prices change. Check as_of. For anything you'll act on, override with COST_PRICING_PATH using your actual contracted rates (including Bedrock regional pricing, batch discounts, or committed-use deals).
Unknown model names are reported, not silently priced at zero.
Read-only by design
- No network calls. The server reads one local file and one pricing table. Nothing leaves your machine except what your MCP client sends to its model.
- No writes. It never modifies the trace file or creates new files.
- No credentials. It doesn't need, ask for, or read API keys.
That said, tool output goes to whatever model your MCP client uses. If your traces contain prompt text, strip it before loading. The schema above doesn't need it.
Exporting traces from your stack
SourceQuick pathBedrock invocation logsAthena query over the S3 log bucket → CSV. Map modelId → model, input.inputTokenCount → input_tokens, output.outputTokenCount → output_tokensOpenAI / Anthropic SDKLog usage from each response alongside your own request_id and feature tagLiteLLM / proxy logsExport spend logs; call_type or route usually maps to featureLangfuse / HeliconeExport to CSV and map columns (native connectors are on the roadmap)The hard part is usually outcome. If you don't record it today, start with "final attempt returned 200 and parsed." It's a floor, not the truth, but it's better than cost per request.
Limitations
- Batch file analysis, not live monitoring.
- model_swap_whatif assumes the target model uses the same token counts. Tokenizers differ; expect ±10–20% drift.
- No quality signal. A cheaper model that fails more often can cost more per success. Re-run cost_per_outcome on a test batch after any swap.
- Monthly projections assume the trace window is representative.
Next
Not in v0.1, on the list:
- [ ] Langfuse and Helicone connectors
- [ ] Bedrock invocation log reader (direct from S3)
- [ ] Prompt-cache hit rate per feature
- [ ] Context-bloat detector (input token drift over time)
- [ ] quality_adjusted_whatif: fold eval pass rates into swap estimates
PRs welcome. Open an issue first for anything bigger than a bug fix.
Development
git clone https://github.com/<your-handle>/cost-per-outcome-mcp
cd cost-per-outcome-mcp
npm install
npm run build
npm run dev -- --trace ./data/sample-traces.jsonl

# Regenerate the synthetic trace
npm run gen:sample

# Inspect tools interactively
npx @modelcontextprotocol/inspector node dist/index.js
Built with the TypeScript MCP SDK over stdio.
Want this done on production traces?
This tool shows you the gap. Closing it means knowing which fixes are safe: prompt trimming, caching, routing, model swaps, each tested against your real requests so quality doesn't drop.
I do that as a one-week, read-only AI Cost Audit for seed–Series B SaaS teams on Bedrock or direct model APIs. You get every fix ranked by $/month, and you keep the findings whether we work together or not.
→ See the AI Cost Audit
License
MIT