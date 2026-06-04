# Command Center Card Registry (Phase 11G)

> **Orchestrator is the brain. Command Center is a read/control surface.**
> Phase 11G does not build UI and does not mutate providers/Supabase/packs.

Cards are grouped into five groups. Every card blocks `execute_provider_mutation`.

## orchestrator

| Card | Source | Risk |
| --- | --- | --- |
| `orchestrator_latest_request` | `hartos-reports/` | low |
| `orchestrator_strategy_review` | `hartos-reports/` | low |
| `orchestrator_cto_review` | `hartos-reports/` | low |
| `orchestrator_build_plan` | `hartos-reports/` | low |
| `orchestrator_handover` | `hartos-reports/`, `docs/HANDOVER.md` | low |

## factory

| Card | Source | Risk |
| --- | --- | --- |
| `factory_provider_status` | `launch-reports/`, `production-reports/` | medium |
| `factory_launch_status` | `launch-reports/` | medium |
| `factory_bootstrap_status` | `bootstrap-reports/` | medium |
| `factory_production_promotion_status` | `production-reports/` | high (approval) |

## beezulbub

| Card | Source | Risk |
| --- | --- | --- |
| `beezulbub_capability_registry` | `capabilities/capability-registry.json` | low |
| `beezulbub_pack_status` | `packs/*/pack.manifest.json` | low |
| `beezulbub_provenance_health` | `capabilities/provenance-ledger.json` | low |
| `beezulbub_conflict_report` | `beezulbub-reports/` | low |
| `beezulbub_implementation_drafts` | `packs/*/pack.manifest.json` | medium (approval) |

## agents

| Card | Source | Risk |
| --- | --- | --- |
| `agents_inventory` | derived | low |
| `agents_runtime_status` | `launch-reports/`, `production-reports/` | medium |
| `agents_debug_events` | none (Supabase; live reads out of scope) | medium |
| `agents_approval_queue` | none (action tokens; live reads out of scope) | high (approval) |

## human_control

| Card | Source | Risk |
| --- | --- | --- |
| `human_manual_required` | derived | medium |
| `human_pending_approvals` | derived | high (approval) |
| `human_blocked_actions` | derived | high |
| `human_next_recommended_command` | derived | low |

## Governance: pack usability

Skeleton and implementation_draft packs are **never** treated as usable.
Verified/available packs require provenance to be considered usable. The read
model enforces this in `classifyPackUsability()`.
