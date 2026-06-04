# LLM Gateway (Phase 11I)

The LLM Gateway is the single, governed boundary through which any HartOS module
may reach a language model. Modules never call a provider directly.

```
Orchestrator / CTO / Agent / Read-model summaries
        ↓
   LLM Gateway  (src/llm/llm-gateway.ts)
        ↓
Provider adapter: openai | deterministic
        ↓
   Output validator
        ↓
   Safe structured response
```

## Guarantees

- **LLM suggests/contextualizes only; it never mutates.** The gateway returns a
  strict structured JSON contract — it never executes actions or writes data.
- **All provider calls go through the LLM Gateway.** There are no scattered
  OpenAI calls in `orchestrator.ts`, `cto-review.ts`, the cockpit server, or any
  agent adapter.
- **Deterministic fallback is always available.** With no provider configured
  (the default), or when a provider returns malformed output, the gateway uses
  the offline deterministic provider. It never crashes.

## Methods

`classifyAndContextualize`, `runStrategyReasoning`, `runCtoReasoning`,
`summarizeAgentStatus`, `summarizeCockpitState`, `summarizeDataSnapshot` — all
return a validated `LlmStructuredOutput`.

## Output contract

```json
{
  "intent": "finance_report",
  "domain": "finance",
  "confidence": "high",
  "neededContext": ["watchlist", "market_data"],
  "recommendedSpecialist": "finance_agent",
  "riskLevel": "medium",
  "nextAction": "generate_stock_watchlist_report",
  "summary": "Hart is asking for a market data report across his watchlist."
}
```

Output is validated for required keys, allowed enum values, max string lengths,
and absence of token-like strings. Malformed output → deterministic fallback.

## Usage logging

`npm run llm:test` writes a redacted usage log under `llm-reports/` recording
provider, model, mode, request type, success, validation status, and timestamp.
No secrets and no raw prompt/source text are stored.

See [LLM_PROVIDER_BOUNDARY.md](LLM_PROVIDER_BOUNDARY.md) for provider gating.
