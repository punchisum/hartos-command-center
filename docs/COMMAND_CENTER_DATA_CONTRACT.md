# Command Center Data Contract (Phase 11G)

> **Orchestrator is the brain. Command Center is a read/control surface.**
> Phase 11G defines the data contract only. Phase 11G does not build UI, and it
> does not mutate providers, Supabase, or packs.

## Purpose

The Command Center data contract defines, deterministically and offline:

- **What cards exist** — see [Card Registry](COMMAND_CENTER_CARD_REGISTRY.md).
- **What data powers each card** — `sourceType` + `sourcePaths`.
- **Where each data source comes from** — local files/reports only.
- **Which actions are read-only / require approval / are forbidden** — see [Action Contract](COMMAND_CENTER_ACTION_CONTRACT.md).
- **Which reports a future cockpit UI will consume** — the JSON sidecars under `command-center-reports/`.

## Allowed local source roots

The Command Center may read these LOCAL paths only. No URLs, no providers, no
network, no Supabase queries:

```text
hartos-reports/
beezulbub-reports/
launch-reports/
production-reports/
bootstrap-reports/
command-center-reports/
capabilities/capability-registry.json
capabilities/provenance-ledger.json
packs/*/pack.manifest.json
docs/HANDOVER.md
docs/*.md
```

`buildDataContract()` throws if any card references a source outside these roots.

## Degrade-safe behavior

When a source directory or file is absent, the read model degrades to:

```text
status: missing
confidence: low
safe recommendation: run the relevant local report command
```

It never crashes when reports are absent, and the recommendation is always a
safe local command — never a mutation.

## Card definition shape

```ts
id
group            // orchestrator | factory | beezulbub | agents | human_control
title
description
sourceType       // report_dir | json_file | doc_file | glob | derived | none
sourcePaths      // local paths only
freshnessPolicy  // latest_report | always_regenerate | static | on_demand
riskLevel        // low | medium | high | critical
allowedActions
blockedActions   // always includes execute_provider_mutation
requiresApproval
```

## Generate it

```bash
npm run command-center:contract   # data-contract-*.md + .json
npm run command-center:cards      # card-registry-*.md + .json
npm run command-center:plan       # cockpit-plan-*.md + .json
```

All output is written under `command-center-reports/` and contains no secrets.
