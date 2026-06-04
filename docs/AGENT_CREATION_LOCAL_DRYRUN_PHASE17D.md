# Phase 17D — Local Scaffold Dry-Run From an Approved Plan

The first "almost-real" phase. From a proposal Hart has **explicitly authorized for execution**, the
Node execution host produces **local artifacts only** — a spec draft, the proposed repo structure, a
`.env.example`, a draft Supabase migration, a draft Cloudflare config, a provider plan, and a
checklist — plus a **closed-gate provision dry-run** proving nothing would mutate. It builds against
the Phase 17C architecture ([AGENT_CREATION_EXECUTION_PHASE17C.md](AGENT_CREATION_EXECUTION_PHASE17C.md)).

## What 17D does
```
Cockpit: "Create a tax agent" → agent_creation_plan proposal (executable:false)   [17A]
  → simulate (markSimulatedApproved)                                              [14B]
  → Hart authorizes: simulated_approved → approved_for_execution (Key 1)          [17C/17D]
       · assigns a DURABLE spec id (distinct from proposal id; survives expiry)
       · records executionAuthorizedAt (no auto-expiry — age is surfaced; revoke is explicit)
  → Hart runs the Node executor:  npm run agent:scaffold-dryrun -- --id=<id>       [17D]
       (A) derives a plan-level spec draft from the approved payload
       (B) writes LOCAL artifacts into agent-scaffold-dryrun/<specId>/ (gitignored)
       (C) builds the ProvisionPlan + checks every gate → dry-run report (gates closed = all blocked)
       · secret-scans every artifact before write (fail closed)
       · records an audit event; the proposal STAYS approved_for_execution (not advanced)
```

## Artifacts (written to `agent-scaffold-dryrun/<specId>/`, gitignored)
- `agent-spec-draft.json` — plan-level spec. **Not** the Factory AgentConfig (that is resolved by the
  Agent Factory in 18A; this is never committed to CC).
- `STRUCTURE.md` — the proposed repo structure (from the plan's scaffold outline).
- `.env.example` — placeholder var names + the provisioning gates, **all commented/closed**. No values.
- `supabase/migrations/0001_DRAFT_schema.sql` — draft migration (only if Supabase is in the plan).
- `wrangler.cockpit.toml.example` — draft hosted-cockpit config (only if Cloudflare is in the plan).
- `provider-plan.md` — every provider step + the gate that blocks it.
- `CHECKLIST.md` — two-key status, open questions, risks, and the gated next steps.

## Commands (Node execution host only — never the Worker)
- `npm run agent:approve-execution -- --id=<id>` — Key 1: authorize (simulated_approved → approved_for_execution).
- `npm run agent:revoke-execution -- --id=<id>` — explicit revoke (no auto-expiry, per 17C §11 Q3).
- `npm run agent:scaffold-dryrun -- --id=<id>` — produce the local artifacts + provision dry-run.

## Hard boundaries (enforced + tested)
- ❌ No repo / Supabase project / Telegram bot creation. ❌ No Cloudflare deploy. ❌ No Trigger task.
- ❌ No `git push`, no PR (that is 18A). ❌ No provider network calls — the provision plan is built and
  gate-checked; the engine's `verify()`/`apply()` are **never** invoked here.
- ❌ No real execution — the proposal is **not** advanced to `executing`/`executed` (that is 18B); 17D
  records an audit event and leaves it at `approved_for_execution`.
- ❌ No secrets written — every artifact is secret-scanned before it touches disk; a hit fails closed.
- ❌ Not reachable from a prompt — the dry-run refuses unless the proposal is `approved_for_execution`,
  which only Hart can set; and even with **all host gates open**, 17D still runs no mutating step
  (proven by test: every mutating step is reported `gate_open_not_run`, never applied).
- ✅ `executeProposal()` still throws; proposals remain `executable:false`.

## Next (gated, future)
- **18A** — scaffold → branch → **PR** (always PR; no local-commit bypass) → Hart review → merge. Still no provider mutation.
- **18B** — open `ALLOW_*` gates one provider at a time: dry-run → apply → ledger → smoke → rollback-ready.
