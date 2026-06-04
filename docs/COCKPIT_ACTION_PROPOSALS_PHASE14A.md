# Cockpit Action Proposals (Phase 14A)

Phase 14A prepares the cockpit for future actions **without executing anything**.
It is proposal + approval + simulation architecture only. There is **no real
execution method anywhere** in this layer.

## Contract (`src/cockpit/proposals/proposal-types.ts`)

`ActionProposal` carries: `id`, `domain` (fitness/ops/factory/system),
`actionType`, `title`, `description`, `sourceIntent`, `proposedPayload`,
`expectedEffect`, `riskLevel` (low/medium/high), `requiredApproval` ("Hart"),
`status`, `createdAt`, `expiresAt`, `safetyNotes`, `blockedReason`,
`dryRunResult`, and `executable: false` (always).

`status`: `draft` → `pending_approval` → `approved_simulated` / `rejected` /
`expired`. There is intentionally **no executed state**.

## Generation (`proposal-generator.ts`)

`generateProposals(ctx)` turns a routed Command HartOS intent into
non-executable drafts:

| Intent | Proposal |
| --- | --- |
| `build_agent` ("Create a tax agent") | build-agent plan draft (no repo) |
| `build_agent` ("What should I build next?") | ranked build plan |
| `improve_agent` | improvement plan + test plan (no code change) |
| `ops_status` | read-only follow-up/review plan (no ClickUp write) |
| `fitness_status` | training/nutrition adjustment plan |
| `strategy_review` | strategy/CTO review note |
| `system_status` / `unknown` | none |

Each draft is simulated (dry-run) at generation time.

## Simulation (`proposal-simulator.ts`, Phase 14A.4)

`simulateProposal(proposal)` returns a `DryRunResult`: what **would** happen,
what data it **would** touch, what approval is required, **why execution is
disabled now**, and what future setup would be required. `executed` is always
`false`.

## Gates (`gates.ts`, Phase 14A.5)

- `ALLOW_COCKPIT_ACTION_PROPOSALS=true` → drafts advance to `pending_approval`.
  (Drafts generate regardless; the gate only controls surfacing for approval.)
- `ALLOW_COCKPIT_ACTION_EXECUTION` → **unsupported**. `executionAllowed()` is
  hard-capped to `false` even if the env var is set.
- `executeProposal()` is the only "execution" entry point and it **always**
  throws `ActionExecutionDisabledError` — execution fails closed.

Read-only Phase 13 functionality never depends on these gates.

## UI

The cockpit shows an **Action Proposals** section. Each proposal is badged
`NON-EXECUTABLE` / `DRY-RUN`, shows domain/risk/status/required approval, the
dry-run result, and the blocked reason. The only button is **disabled**
("Simulate only — cannot execute"). No button executes anything; there are no
provider calls and no writes.
