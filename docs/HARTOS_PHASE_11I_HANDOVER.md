# HartOS Phase 11I Handover — LLM Gateway + Real Read-Only Integrations

## What shipped

- **Part 0 — Cockpit response detail fix.** Ask HartOS now updates the "Latest
  response detail" panel live (client-side mirror of the server renderer), so it
  no longer stays on the empty-state after a request succeeds.
- **Part A — Governed LLM Gateway** (`src/llm/`). Single boundary for LLM
  reasoning; deterministic by default; OpenAI gated by explicit env; output
  validation + redaction + usage logging.
- **Part B — Read-only agent integration** (`src/agents/`). Ops + Fitness
  adapters read only local paths; config-first via `agent-integrations.local.json`.
- **Part C — Read-only read models** (`src/read-models/`). Strict read-only
  Supabase boundary; disabled by default; config-first via
  `read-models.local.json`.
- **Cockpit integration.** New "Real Agents" and "Real Data" sections; Ask
  HartOS attaches optional LLM contextualization.

## Doctrine (unchanged boundaries)

- LLM suggests/contextualizes only; it never mutates.
- All provider calls go through the LLM Gateway.
- OpenAI is gated by explicit env (`HARTOS_LLM_ENABLE_NETWORK=true`).
- Deterministic fallback is always available.
- Agent integrations are read-only.
- Read models are read-only.
- The Supabase read client exposes no mutation methods.
- The cockpit does not call Ops/Fitness internals directly.
- No Telegram, no Supabase mutation, no ClickUp mutation, no Apple Health
  mutation, no Google Drive mutation, no deploys, no action execution.

## Commands

```
npm run llm:status
npm run llm:test -- --request="What should I build next?"
npm run agents:status
npm run read-models:status
npm run cockpit:ask -- --request="What is the status of my Ops Agent and Fitness Agent?"
```

## Reports written (all local, gitignored)

`llm-reports/`, `agent-integration-reports/`, `read-model-reports/`,
`cockpit-reports/`, `cockpit-threads/`.

## Works without internet

Everything: the gateway falls back to deterministic, agent adapters read local
files, read models report disabled/unconfigured, and the cockpit renders fully.

## Requires explicit env/network gate

Only live OpenAI reasoning (`HARTOS_LLM_PROVIDER=openai` +
`HARTOS_LLM_ENABLE_NETWORK=true` + `OPENAI_API_KEY`) and live Supabase reads
(`enabled=true` + the configured read-only URL/key env vars).

## Not implemented by design

No action execution, no hosted cockpit, no auth, no Supabase persistence writes,
no provider mutations, no pack auto-generation/implementation/promotion.

## Suggested Phase 11J

Wire additional read-only datasets behind the same boundary; add a read-only
"explain this card" gateway call per cockpit card; optional cached LLM summaries
in snapshots.
