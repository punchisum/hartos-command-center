# TOMORROW EXECUTION PLAN (2026-06-10)

Decision forced by the audit: **everything is BUILT + DEPLOYED but NOT_PROVEN.** Tomorrow is a
**proof + usefulness** day, not a build day.

## Recommended track: **A — Live Graduation (tightly scoped)**
Not "build more." Push/deploy are done. Tomorrow converts the largest cluster of NOT_PROVENs to
PROVEN, and turns the deployed cockpit from impressive → daily-useful. Three priorities, no more.

> Why not the other tracks: **B (Cockpit redesign)** — already built; the gap is data, not design.
> **C (Instruction→Proposal)** — already shipped (Phase 1). **D (Research→Capability)** — least mature
> (no executor) and explicitly downstream of a proven floor; premature. **E (Mixed)** — this *is* a
> tight mix, bounded to the 3 priorities below; do not expand it.

---

## Priority 1 — Fire the first live mutation canary (prove L0 + L4)

- **Objective:** Execute ONE real, reversible mutation end-to-end through the gate, and observe the
  audit row + StateDelta. (Start with a **ClickUp comment** — its flag `ALLOW_EXEC_CLICKUP_COMMENT` is
  already armed in `.env.local` and a comment is purely additive/idempotent; then optionally the
  on-hold **move**.)
- **Why it matters:** This single act proves the *entire* execution floor — the fail-closed gate,
  the adapter's live read-before-write, the dispatcher, the append-only audit, and the §13 delta — with
  real data. It collapses the biggest NOT_PROVEN cluster (L0 + L4) in one reversible step. Nothing
  downstream can be trusted until the system has acted once, safely and observably.
- **Files/areas:** `scripts/run-approved-executor.ts` (`npm run execute:approved`), `scripts/run-mutation.ts`,
  `src/execution/adapters/clickup-comment.ts` / `clickup-move-status.ts`, the proposal queue
  (`cockpit-proposals/`), `cockpit_proposal_audit` (Supabase), `docs/MUTATION_GO_LIVE.md`.
- **Definition of done:** A real ClickUp card shows the HartOS comment (or moved status); the proposal
  advanced to `executed`; an append-only audit row exists in `cockpit_proposal_audit`; a StateDelta was
  emitted; re-running is a verified no-op (idempotent); the change was reversed cleanly.
- **Risk:** Low. Comment is additive + idempotent; move is reversible. Worst case = a wrong comment,
  deletable by hand in seconds. Real risk is creds/wiring (token, flag) failing → honest `no_write`.
- **Fallback if blocked:** If ClickUp creds/flag aren't ready, fire the **refresh-sync canary**
  (`scripts/run-canary-refresh-sync.ts`, internal-only, reversible) instead — it proves the same gate +
  audit + TLS path with zero external dependency. Either canary proves the floor.

## Priority 2 — Make the cockpit useful daily (prove L3 + Cockpit with real data)

- **Objective:** (a) Log into the deployed cockpit and **verify real fitness/ops data renders** (not
  placeholders). (b) **Close the Executive Memory loop**: build a small Node memory-heartbeat persister
  that calls `captureSnapshot()` against a Supabase-backed `MemoryStore`, set `HARTOS_MEMORY_CAPTURE=true`,
  and thread `ctx.memorySnapshots` so Executive Memory stops showing INSUFFICIENT_HISTORY.
- **Why it matters:** The cockpit is the daily surface. Right now it's deployed-but-unverified and its
  memory section is permanently empty. Real data + a filling memory is what makes Hart open it every
  morning — the "useful daily" milestone.
- **Files/areas:** `src/runtime/cloudflare-live-read-models.ts` (read-model resolve), a new
  `scripts/memory-heartbeat.ts`, a Supabase `MemoryStore` impl of `src/awareness/memory-store.ts`,
  `src/awareness/memory-capture.ts`, the worker's `/api/ask` + state path for `memorySnapshots`.
- **Definition of done:** Screenshot/confirm the live cockpit shows real ops/fitness numbers behind
  login; after ≥1 heartbeat run, Executive Memory shows ≥1 real snapshot (and, over repeated runs, a
  recurring pattern) instead of INSUFFICIENT_HISTORY.
- **Risk:** Low–medium. Read-only verify is zero-risk. The persister writes only compact snapshots to a
  HartOS-owned table (no external system). Honesty floor stays: empty history still renders honestly.
- **Fallback if blocked:** If the Supabase store wiring is heavy, ship the **verify-live-data** half
  alone (proves Cockpit) and capture memory snapshots to a local JSON store first (proves the loop
  locally), deferring the Supabase persister.

## Priority 3 — Wire LLM reasoning into the deployed Ask path (prove L2)

- **Objective:** Make the deployed `/api/ask` actually reason with an LLM behind the capability-token
  gate (`ctx.askInfer` wired via the Node/Edge Ask host), propose-only, with rule-based fallback and
  freshness/gap citations. Verify a live request returns `usedLlm=true` with real reasoning.
- **Why it matters:** "HartOS talks back" is currently deterministic in production — the LLM seam is
  built but never called live. This is the most contained remaining proof (a wiring, not a build) and
  the one Hart explicitly asked for; it upgrades daily usefulness of Ask.
- **Files/areas:** `scripts/cockpit-ask-host.ts`, `src/llm/ask-llm.ts`, `src/llm/llm-gateway.ts`,
  the Ask host deploy target (Edge Function or Node instance), env (`HARTOS_LLM_PROVIDER=openai`,
  `HARTOS_LLM_ENABLE_NETWORK=true`, `OPENAI_API_KEY`).
- **Definition of done:** A live `/api/ask` (through the Ask host) returns an LLM-reasoned, risk-rated
  answer citing freshness/gaps; with the key/flag absent it falls back to deterministic cleanly; the
  read-only Worker still holds no key.
- **Risk:** Medium. Network + API key + cost. Bounded by propose-only (no execution from Ask), redaction,
  and output-validation. Worst case = fall back to deterministic (current behaviour) — no regression.
- **Fallback if blocked:** Keep the deterministic Ask (no regression) and ship P1 + P2 only. LLM
  reasoning is the lowest-priority of the three; drop it without guilt if P1/P2 consume the day.

---

## What NOT to do tomorrow (blunt)
1. **Do NOT build or birth a full agent** (Factory go-live) — premature until the mutation floor is
   proven and the cockpit renders real data. Birthing into unproven foundations is the trap.
2. **No Obsidian build** — meaning layer; waits for live proof. (Contract groundwork already exists.)
3. **No Research Agent executor / flywheel automation** — downstream of a proven floor.
4. **No broad autonomous execution** — every mutation stays human-approved + flag-gated + one-at-a-time.
5. **No new intelligence patches** (depth/awareness/memory) — the engines are done; the gap is data flow.
6. **No new cockpit visual/redesign work** — V2 is shipped; the gap is data, not pixels.
7. **No giant refactor / abstraction layer** — nothing demands one.
8. **No raw code generation** — outside the Escalation Policy; not needed.
9. **No new MCP/integration surfaces** (Telegram extras, new providers) — off the critical path.
10. **No multi-card / bulk mutation** — canary is exactly ONE reversible action.
11. **No arming multiple ALLOW_EXEC_* flags** — arm only the one action you're firing, disarm after.
12. **No “proven live” claims without an audit row + observed effect** — proof means evidence, not deploy.

---

*Tomorrow is DEPLOY/PROVE-focused, not build. One canary, real cockpit data + memory loop, and (budget
permitting) live LLM Ask. Then — and only then — birth the first agent into a proven environment.*
