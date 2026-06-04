# Command Center Action & Approval Contract (Phase 11G)

> **Orchestrator is the brain. Command Center is a read/control surface.**
> Phase 11G does not execute actions, does not build UI, and does not mutate
> providers/Supabase/packs. This is a contract only.

## Action states

```text
read_only               — safe to expose freely
local_report_generation — deterministic, offline, no mutation
approval_required        — needs human/admin approval; never auto
manual_required          — needs a manual human step
forbidden                — not allowed in Phase 11G (or any auto path)
future                   — reserved for a later phase
```

## Action → state rules (enforced by tests)

```text
view_report               = read_only
generate_report           = local_report_generation
run_orchestrator          = local_report_generation
run_strategy_review       = local_report_generation
run_cto_review            = local_report_generation
run_build_plan            = local_report_generation
run_launch_verify         = local_report_generation
run_bootstrap_verify      = local_report_generation
approve_manual_required   = approval_required
promote_pack              = approval_required   (existing safe gates only)
deploy_agent              = manual_required
execute_provider_mutation = forbidden
```

**Dangerous actions are never `read_only`.** `assertNoDangerousReadOnly()`
throws if any provider/pack/deploy/approve action is mis-declared as safe.

## Approval contract

Categories:

```text
none | human_review | human_approval | admin_approval | forbidden
```

Reasons:

```text
provider_mutation | supabase_mutation | pack_promotion | production_deploy
secret_boundary | third_party_code | data_privacy | business_critical
```

Mapping highlights:

```text
execute_provider_mutation → forbidden        (provider_mutation, supabase_mutation, secret_boundary)
promote_pack              → admin_approval   (pack_promotion, third_party_code)
deploy_agent              → human_approval   (production_deploy)
approve_manual_required   → human_approval   (business_critical)
view_report / generate_report / run_* → none
```

`assertNoDangerousWithoutApproval()` throws if any dangerous action resolves to
approval category `none`. This makes it impossible for a future UI to treat a
dangerous action as safe.

## What this prevents

- A cockpit cannot render a provider mutation as a one-click button (forbidden).
- A cockpit cannot auto-promote a pack (admin approval + existing safe gates).
- A cockpit cannot auto-deploy (manual/approval required).
