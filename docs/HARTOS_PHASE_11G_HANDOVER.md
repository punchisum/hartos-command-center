# HartOS Phase 11G Handover — Coverage Patch + Command Center Data Contract

## What shipped

**Part A — 11F.1 coverage patch.** The generated-agent test command now runs the
11D/11E runtime suites that were previously only run at the factory root:
`beezulbub-capability-registry`, `beezulbub-provenance-ledger`,
`beezulbub-pack-conflicts`, `beezulbub-pack-verifier`, `beezulbub-pack-promotion`,
`beezulbub-pack-implementation-templates`, `beezulbub-pack-implementation-engine`.
Generated agents now carry the same governance guarantees as the factory.

**Part B — Command Center data contract.** A new local, deterministic,
report-based module under `src/command-center/`:

- `command-center-types.ts` — card, action, approval, read-model, plan types
- `card-registry.ts` — 22 cards across 5 groups
- `data-contract.ts` — allowed local source roots + assembly with safety asserts
- `read-model.ts` — reads local files, degrades safely, enforces pack usability
- `action-contract.ts` — action → state map; dangerous actions never read-only
- `approval-contract.ts` — approval categories/reasons; dangerous never "none"
- `cockpit-plan.ts` — next safe command + future cockpit phases
- `command-center-report.ts` — secret-safe report formatting + writers
- `command-center.ts` — entry point that assembles a full snapshot

Scripts: `command-center:contract`, `command-center:cards`, `command-center:plan`
(all using the proven `pre<script>` build hook + compiled `dist/scripts/*.js`).

Reports are written under `command-center-reports/` as `*.md` + `*.json`.

## Architectural rule

```text
Orchestrator = brain (decides)
Command Center = control surface (reads + routes; never decides, never mutates)
```

- Command Center is **not** the brain.
- Phase 11G **does not build UI**.
- Phase 11G **does not mutate** providers / Supabase / packs.

## How to run (offline)

```bash
npm run command-center:contract
npm run command-center:cards
npm run command-center:plan
```

All three work with no reports present (every card degrades safely).

## What is intentionally NOT implemented

- No cockpit UI / web frontend (Phase 11H+).
- No live provider / Supabase / GitHub / OpenAI reads.
- No action execution — actions are declared, never run.
- No pack auto-generation/implementation/promotion.

## Recommended next phase

`11H_read_only_cockpit` — build a read-only cockpit that renders cards from the
data contract + read model and views reports only. No actions, no mutation.
