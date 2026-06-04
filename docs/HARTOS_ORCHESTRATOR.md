# HartOS Orchestrator

**Phase 11F** — Orchestrator + CTO MVP

## What it is

The Orchestrator is the **command router / chief of staff**. It is the first
MVP of the HartOS command brain. It is local, deterministic, and report-driven.

It does **not** execute anything. It produces reports and recommended next
commands only.

## Hierarchy

```
Hart
 ↓
Orchestrator         ← command router / chief of staff
 ↓
Specialists / modules
   CTO               = engineering / build specialist
   Prophet           = strategy-review module inside the Orchestrator
   Beezulbub         = capability acquisition tool
   Factory           = production line
   Command Center    = future cockpit (NOT this phase)
```

The CTO is **not** the top-level boss. The Orchestrator routes; the CTO advises
on engineering.

## Flow

```
Hart request
→ Orchestrator classifies request
→ Strategy review decides if the idea is worth pursuing (if needed)
→ CTO reviews the technical path (if engineering/build)
→ Capability gaps are detected
→ Existing packs/capabilities are checked
→ Beezulbub/Factory actions are recommended
→ Build plan + handover are produced
```

## Command

```bash
npm run hartos:orchestrate -- --request="I want to build a tax specialist agent"
```

Steps performed:

1. Parse request
2. Classify request (`request-classifier.ts`)
3. Run strategy review if needed (`strategy-review.ts`)
4. Run CTO review if engineering/build (`cto-review.ts`)
5. Detect capability gaps (`capability-gap.ts`)
6. Generate build plan (`build-plan.ts`)
7. Write report + safe JSON sidecar to `hartos-reports/`

## Output

```
hartos-reports/
  orchestrator-<timestamp>.md     ← human-readable report
  orchestrator-<timestamp>.json   ← safe sidecar consumed by hartos:handover
```

Reports are deterministic and secret-safe (`assertNoSecretsInReport`).

## Safety

The Orchestrator and its modules MUST NOT:

- execute provider mutations
- promote / implement / generate packs
- call live GitHub
- deploy anything
- touch Supabase live
- write or print secrets
- treat skeleton packs as production-ready

They may only produce reports and recommended next commands.

## Configuration

- `HARTOS_REPORTS_DIR` (optional) — overrides the default `hartos-reports/` dir.

---

Phase 11F — HartOS Agent Factory v2
