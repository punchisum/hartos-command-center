# Cockpit Security Boundaries (Phase 11H)

> The cockpit is local, but it is designed as if future hosting is possible.
> The safety rules below are enforced in code and covered by tests.

## Hard rules (enforced + tested)

- **No provider mutation** from the cockpit.
- **No Supabase mutation** from the cockpit.
- **No pack mutation** from the cockpit.
- **No deploy** action from the cockpit.
- **No network calls** — the cockpit reads local files and runs local Orchestrator
  logic only.
- Dangerous actions render as **disabled/blocked**.
- Approval-required and manual-required actions render as **non-executable**.
- Forbidden actions (e.g. `execute_provider_mutation`) render as **blocked**.
- User request input is **validated** (non-empty, length-limited).
- Secret-looking input is **rejected** (never run, never written to reports).
- Reports never contain token-like strings (`assertNoSecretsInReport`).

## How execution is prevented

Every action button is rendered with the HTML `disabled` attribute and
`executable: false`. Phase 11H has **no execution path** for any action — the
cockpit produces recommendations and structured Orchestrator output only.

The action/approval safety states come straight from the Phase 11G Command
Center contracts (`action-contract.ts`, `approval-contract.ts`), so the cockpit
cannot invent a "safe" state for a dangerous action.

## Local persistence

- `cockpit-reports/` — snapshot + thread reports (`.md` / `.json` / `.html`).
- `cockpit-threads/` — persisted threads (`thread-*.json`) and messages
  (`message-*.json`).

Both are local-only. No Supabase, no remote storage.

## Pack lifecycle preserved

The cockpit renders the Command Center read model, which never treats
`skeleton` or `implementation_draft` packs as usable and requires provenance for
verified/available packs. The cockpit does not weaken these rules.
