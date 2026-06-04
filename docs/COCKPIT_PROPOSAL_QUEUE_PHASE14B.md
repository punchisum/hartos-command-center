# Local Proposal Queue (Phase 14B)

Phase 14B persists proposal drafts locally so Command HartOS proposals survive
past a single response. **Still no real execution** — every queue path is
read/inspect/simulate only; the sole execution entry point fails closed.

## Storage

- Folder: `cockpit-proposals/` — **gitignored** (the Factory `.gitignore`
  template includes it, alongside `cockpit-reports/` and `cockpit-threads/`).
- One JSON sidecar per proposal (filesystem-safe filename; real id is inside).
- A **secret check runs before every write** — files are safe to inspect.
- If storage is unavailable, the queue degrades gracefully and the cockpit keeps
  the response-only proposals.

## Contract (`ProposalQueueItem`)

Extends the Phase 14A `ActionProposal` (so `executable: false` stays) with:
`status` (`draft` · `pending_approval` · `simulated_approved` · `rejected` ·
`expired`), `updatedAt`, and `auditEvents` (`{ at, event, detail? }`).

## Operations (`src/cockpit/proposals/proposal-queue.ts`)

`saveProposal` · `listProposals` (newest first) · `readProposal` · `resolveRef`
(by 1-based number or id) · `rejectProposal` · `markSimulatedApproved` ·
`appendAudit` · `expireStaleProposals` · `dryRunProposalInQueue`.

There is **no execute operation**. `gates.executeProposal()` always throws
`ActionExecutionDisabledError`; `ALLOW_COCKPIT_ACTION_EXECUTION` stays
unsupported/false.

## Command HartOS behavior (14B.5)

- build/improve/ops/fitness/strategy Asks generate drafts and **save them to the
  queue** (status `draft`, or `pending_approval` when
  `ALLOW_COCKPIT_ACTION_PROPOSALS=true`).
- "Show pending proposals" → `proposal_list` (lists the queue).
- "Reject proposal &lt;n|id&gt;" → `proposal_reject` (local queue update only).
- "Dry run proposal &lt;n|id&gt;" → `proposal_dryrun` (simulation only).
- Stale proposals are expired before each Ask.
- An unknown proposal ref fails safely with a helpful message.

## UI

A **Proposal Queue** section shows pending proposals + history with risk, status,
dry-run result, required approval, an audit-event count, and labels:
**NON-EXECUTABLE · DRY-RUN ONLY · REAL EXECUTION DISABLED**. The only button is
disabled.
