> **HartOS Doctrine (binding).** This agent is governed by the **HartOS Shared Doctrine v1** — the constitution for every HartOS agent (canonical: `docs/HARTOS_SHARED_DOCTRINE.md`). Five overriding clauses: (1) Supabase = facts, Obsidian = meaning, LLM = reasoning; (2) deterministic verdicts before LLM explanation; (3) propose, do not act — the human-approval floor is permanent; (4) honest staleness always (unknown is not failure; fake confidence is); (5) depth before breadth.

# Target Agent Instructions

This repo was scaffolded from HartOS Agent Factory.

- Inspect relevant files before editing.
- Keep changes small and reversible.
- Never hardcode secrets.
- Use Supabase as source of truth.
- Use Trigger.dev for execution.
- Use Telegram as interface when applicable.
- Run verification before saying done.
- Write handover after major changes.
- Use ClickUp only as a visual task layer, not source of truth.
