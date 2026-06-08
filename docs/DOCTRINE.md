# HartOS Doctrine v2

> GENERATED FROM `src/doctrine/doctrine.ts` — do not edit by hand. Every clause below is
> machine-checked by `tests/doctrine-conformance.test.ts`; a violation fails CI. This is the
> single source of truth that generated agents (Phase 4) import for real, code-level guards.

## Read-only first

The hosted Worker reads; it never mutates. No mutation endpoints exist.

_Enforced by: cloudflare-security MUTATION_ENDPOINTS='none' + the GET/POST/OPTIONS method allowlist_

## Propose before execute

Every action is a non-executable proposal until approved. No code path performs a real action.

_Enforced by: proposals/gates executeProposal() throws ActionExecutionDisabledError; proposals are executable:false_

## Human approval floor

Nothing executes without Hart's explicit, per-action approval.

_Enforced by: the approval spine (Phase 2.2 lifecycle) + the fail-closed precondition (Phase 2.5)_

## No secret exposure

Secrets stay server-side — never in HTML/JS/logs. Writes go through a capability token, never a DB key, and never from the Worker.

_Enforced by: security checklist + the Edge Function capability token (HARTOS_ASK_WRITE_TOKEN); pg isolated to Node_

## Freshness + confidence honesty

Verdicts carry honest freshness and derived confidence; neither is ever faked.

_Enforced by: agent-signal derived confidence + freshness-from-age; degraded reads surface why_

## Source-of-truth ownership

Agent decisions/outputs are shared state in Supabase; each domain owns its own data.

_Enforced by: per-domain read-models + the proposal/audit spine_

## Agent domain ownership

Each agent owns its domain; the cockpit reads it, and never reaches into another agent's writes.

_Enforced by: the read-only anon RPC boundary per domain_

## Audit trail

Every state transition and execution writes an immutable audit entry (who/what/when/before/after).

_Enforced by: the append-only audit log (Phase 2.3)_

## Fail-closed

When in doubt, deny. Execution is disabled by default; only one allowlisted, approved, audited action may ever run.

_Enforced by: ACTION_EXECUTION='disabled' + executionAllowed() hard-capped false + the Phase 2.5 precondition gate_
