# Mutation Go-Live Runbook — first real ClickUp move (2026-06-09)

The "put this operation on hold" loop is built end-to-end as a **dry-run rehearsal**. This runbook
is the part that is **yours to run** — arming + firing ONE real card move — because it needs your
ClickUp credentials and runs on your Node host. I (the agent) do not handle your secrets, fire live
writes, push, or deploy. Everything below you run by hand.

> Risk posture (your call, accepted): a ClickUp status move is reversible and visible — if it goes
> wrong you fix it in ClickUp in seconds. That's why this is the right first canary.

---

## What's already built (no action needed)
- Instruction → resolved card → **complete, tier-valid T3 move proposal** (dry-run, `executable:false`).
- `get_ops_attention_cards` now preserves `card_id · title · status` into `state.opsCards`, so
  "put this operation on hold" resolves to a real card when your live ops read-model is connected.
- `on hold` is in the approved-transition allowlist (`in progress / in review / waiting on hart → on hold`; `on hold → in progress`).
- The gated fire path: `npm run mutate` (`scripts/run-mutation.js`) → `dispatchMutation` → the
  fail-closed `clickup-move-status` adapter. Default-OFF; refuses without the flag.

---

## Preconditions (verify once)
1. **ClickUp API token** available to the Node host as `CLICKUP_API_TOKEN` (in `.env.local`, never committed).
2. **Your ClickUp statuses match the allowlist.** The approved transitions use the literal statuses
   `waiting on hart`, `in progress`, `in review`, `on hold`, `complete` (case/space-insensitive). If
   your board uses different names, the move will safely show **BLOCKED / refused** — edit
   `APPROVED_CLICKUP_TRANSITIONS` in `src/execution/adapters/clickup-move-status.ts` to match, then rebuild.
3. **Kill-switch off**: `HARTOS_EXECUTION_KILL_SWITCH` unset (or not `on`).

> Honest caveat: `get_ops_attention_cards.status` may surface a reason ("URGENT") rather than the
> ClickUp workflow status. If so, in-cockpit resolution will BLOCK the move (transition not approved)
> — that's safe, never a wrong write. For the canary below you pass the **real workflow status**
> explicitly via `--from`, so it doesn't depend on that field.

---

## Step 1 — DRY-RUN the exact move (no write, proves connectivity + scope)
Pick one real card id + its current status. Then:
```
npm run build
node --env-file-if-exists=.env.local dist/scripts/run-mutation.js \
  --adapter clickup-move-status \
  --card <CARD_ID> --proposal canary-1 \
  --from "in progress" --to "on hold"
```
Expected: a dry-run line — *"would move card … in progress → on hold. No write performed."* — and
it will tell you the flag is OFF. **Nothing was written.** If it says the transition isn't approved,
fix your statuses/allowlist (precondition 2) and re-run.

## Step 2 — ARM exactly one action + FIRE one card
Add to `.env.local` (never committed):
```
ALLOW_EXEC_CLICKUP_MOVE=true
```
Then fire the SAME command with `--execute`:
```
node --env-file-if-exists=.env.local dist/scripts/run-mutation.js \
  --adapter clickup-move-status \
  --card <CARD_ID> --proposal canary-1 \
  --from "in progress" --to "on hold" --execute
```
The adapter does a **live read-before-write**: it re-reads the card, refuses if the live status ≠
`--from` (someone changed it) or the transition isn't approved. On success it moves the card and
emits one audit/state-delta. Idempotent: re-running is a no-op (already in `on hold`).

## Step 3 — VERIFY + (if needed) ROLL BACK
- Verify in ClickUp the card is now **On Hold**.
- To undo (the proposal's rollback note): re-run with `--from "on hold" --to "in progress" --execute`,
  or just change it back in ClickUp by hand.

## Step 4 — DISARM (recommended between sessions)
Remove `ALLOW_EXEC_CLICKUP_MOVE=true` from `.env.local` so the action returns to default-OFF until
you next intend to fire.

---

## How this connects to the cockpit "type/voice → approve" UX
- In the cockpit, *"this operation has been stalled, put it on hold"* (typed or voiced) →
  the mutate rehearsal resolves the card (via `state.opsCards`) and shows the **READY** T3 proposal.
- Approving it in the cockpit advances the **proposal's** status (gated Edge Function) — it does NOT
  itself hit ClickUp. The actual ClickUp move is fired by the Node host (Step 2). Wiring "approved
  proposal → auto-dispatch the move on the host" is the next optional build; until then the approve
  + fire are two deliberate steps (approve in cockpit, fire on host), which keeps a human between
  intent and write.

## Invariants (unchanged)
- Default-OFF per action; global kill-switch overrides; live read-before-write; reversible; audited.
- The read-only Worker never executes and holds no ClickUp/DB key. The CLI prints names, never secret values.
