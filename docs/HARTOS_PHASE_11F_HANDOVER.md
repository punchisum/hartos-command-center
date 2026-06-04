# HartOS Phase 11F Handover

**Phase 11F** — Orchestrator + CTO MVP

## What shipped

The first MVP of the HartOS command brain — local, deterministic, report-driven:

- **Orchestrator** (`hartos:orchestrate`) — classifies a request and runs the
  full flow (classify → strategy → CTO → gap → build plan → report).
- **Strategy Review / Prophet** (`hartos:strategy-review`) — decides whether an
  idea is worth building; guards against infrastructure cosplay.
- **CTO Review** (`hartos:cto-review`) — engineering review against the
  capability registry / provenance ledger; respects the pack lifecycle.
- **Build Plan** (`hartos:build-plan`) — structured build sequence, approval
  gates, do-not-build list, next prompt skeleton.
- **Handover** (`hartos:handover`) — concise paste-ready summary from the latest
  orchestrator report.

## The `hartos:handover` command

```bash
npm run hartos:handover
```

Reads the latest `hartos-reports/orchestrator-*.json` sidecar and produces:

```
Current request
Classification
Strategy verdict
CTO verdict
Capability status
Recommended next action
Commands to run next
Risks
Open questions
```

Degrades safely when no prior report exists.

## What works without internet

Everything in Phase 11F. No network calls, no provider mutations, no Supabase,
no GitHub. All output is local reports under `hartos-reports/`.

## What is NOT implemented (by design)

- Command Center / cockpit frontend
- Obsidian / Cerebro integration
- Self-healing, worker swarm
- Telegram runtime, Supabase live persistence, Cloudflare routes, Trigger jobs
- Actual app generation / autonomous execution
- Provider mutations

## Safety guarantees

- No provider mutation
- No pack mutation (registry / ledger / manifests untouched)
- No secrets generated or printed (`assertNoSecretsInReport`)
- Skeleton / implementation_draft packs are never treated as production-ready

## Next phase

**Phase 11G: Command Center Data Contract + Cockpit MVP planning.**
Do not build the frontend until the data contract is clear.

---

Phase 11F — HartOS Agent Factory v2
