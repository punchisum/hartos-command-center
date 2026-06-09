# Make HartOS Better — System-Quality Report (2026-06-09)

Sprint type: system-quality, not new-feature. Focus: usefulness density, truthfulness,
actionable warnings, proposal hygiene, live canary, failure recovery. No new agents,
no Obsidian, no broad autonomy, no production mutation, no gate weakening.

---

## Top Issues Found

1. **Proposals were hard to approve/reject** — the queue panel showed only title + risk + status.
   `expectedEffect`, `description`, and any "why approve / why reject" reasoning existed on every
   proposal but were dropped in `proposalsView`. The operator had to open the local cockpit to
   understand what a proposal even did.

2. **No proposal hygiene at render time** — `expireStaleProposals` / `expireDuplicateProposals`
   run only on explicit command. Until Hart ran them, the snapshot showed duplicates and past-expiry
   proposals as if fully active — noise that buried the real signal.

3. **Failure/empty states lacked recovery structure** — `panelMissing()` said *what* was missing
   but not *likely cause → exact next step → route to check → expected healthy result*. Borderline
   "something's wrong" messaging.

4. **No single canary covered the auth/gate fail-closed behaviors** — the refresh-sync canary checks
   the execution gate; the cockpit smoke checked read-route auth. Neither asserted in one place that
   the **proposal-transition route refuses without auth** and **fails closed when no provider is wired**.

5. **Answer confidence was implicit** — the Ops answer had verdict + why + next action + freshness,
   but never stated a confidence even though it's derivable from how many core fields actually resolved.

---

## Changes Made

### A. Usefulness density — Ops confidence + source line
`answerOps()` now states an **honest confidence** derived purely from data completeness + freshness
(no invented score): `HIGH` when ≥4/5 core ops fields resolved and data is current, `LOW` when stale
or ≤1 resolved, else `MEDIUM`. The source is named explicitly.

**Before:**
```
Ops is red. 3 urgent cards and 1 blocked/at-risk card need attention now.
Main action: Triage the 1 blocked/at-risk card first.
Cards: 12 active, 3 urgent, 1 blocked/risk, ...
```
**After:**
```
Ops is red. 3 urgent cards and 1 blocked/at-risk card need attention now.
Main action: Triage the 1 blocked/at-risk card first.
Confidence: HIGH (5/5 core ops fields resolved). Source: ops read-model (ClickUp), current.
Cards: 12 active, 3 urgent, 1 blocked/risk, ...
```

### B/D. Proposal hygiene + decision reasoning in the queue view
`proposalsView` now derives, **read-only (no write)**:
- `effect` — plain-English what-it-does (from `expectedEffect`/`description`)
- `whyApprove` / `whyReject` — deterministic decision reasoning (no LLM)
- `duplicate` flag — same `domain|actionType|title` among active proposals; newest kept, rest flagged
  (mirrors `expireDuplicateProposals` rules without mutating)
- `staleExpired` flag — past `expiresAt` while still draft/pending
- view-level `duplicates` / `staleExpired` counts

`proposalBox` renders the effect + ✓Approve / ✗Reject lines for pending proposals, a risk tag, a
hygiene banner with the exact cleanup command, and dims flagged rows.

**Before (per proposal):** `Refresh the ClickUp import [needs approval] [Approve][Reject]`

**After (per proposal):**
```
Refresh the ClickUp import  [needs approval] [low risk] [Approve][Reject]
  Ops data would be refreshed from the latest ClickUp import.
  ✓ Approve: Advances "Refresh the ClickUp import" (ops). … Dry-run only — approval just clears it
    for a future gated, audited step; nothing executes now.
  ✗ Reject: Reject if the effect above isn't what you want, or you'd rather act manually.
Hygiene: 1 duplicate · 1 past-expiry — ask "expire duplicate proposals" to clean the queue.
```

**Crucial safety note:** the durable dedup/expiry **write** stays an explicit command — the Worker
holds no DB key and never mutates. The view only *derives and surfaces* hygiene honestly. No gate weakened.

### F. Failure recovery — `panelMissing()` 5-part format
**Before:**
```
No ops panel was available. Configure agent-integrations.local.json (and optionally a ops read-model)
to surface ops status.
```
**After:**
```
Ops status is UNAVAILABLE — no ops panel resolved.
Likely cause: the ops agent isn't in agent-integrations.local.json, or its read-model env isn't set on the Worker.
Next step: add the ops agent to agent-integrations.local.json, then run `npm run agents:status` to confirm it's detected.
Check: `npm run read-models:status` (source wiring) and GET /api/read-models/status (live snapshot).
Expected when healthy: ops appears as a configured source with a live/fresh read-model and this answer shows a verdict.
```

### E. Live canary — proposal-transition auth + execution-gate fail-closed
`npm run smoke:hosted` (mocked, no network, no mutation) now includes a **Proposal-transition gate**
section asserting:
1. `POST /api/proposals/transition` without token → **401**
2. Authed + valid body + no provider wired → **200 but `ok:false`, `attempted:false`, advisory-only** (fail closed)
3. Authed + invalid action → **400** (input validation before any relay)
4. Execution gate stays **disabled** while the transition route is live

All 5 new checks pass; total smoke = 33 checks green.

---

## Truth & Freshness — what stayed honest

- No fake green: the hygiene banner and `staleExpired`/`duplicate` flags surface real queue debt
  rather than hiding it.
- Proposal view still reports `mode: read_only_snapshot` / `origin: local` / `executable: disabled`.
- Ops confidence drops to `LOW` automatically when ClickUp data is stale — it never claims HIGH on stale data.

---

## Remaining Risks

- **Freshness vocabulary is still 3-state** (`fresh`/`stale`/`unknown` + `reports_only`/`unavailable`).
  The mission's richer set (`live`/`fallback`/`mocked`/`local-only`) is surfaced via existing `mode`/`origin`
  labels, not a first-class enum. A full enum expansion was **intentionally deferred** (abstraction ripple).
- **Hygiene is view-only** — duplicates/expired are flagged but not auto-removed. By design (Worker is
  read-only); Hart still runs the explicit cleanup command. This is the correct safety posture, not a gap.
- Confidence label added to Ops only this sprint; Fitness/Factory answers still embed confidence implicitly.

---

## Intentionally Not Touched

- Approval gates, execution path, the read-only Worker write-contract.
- Freshness type/enum expansion (deferred — too broad for a surgical sprint).
- New agents, Obsidian, broad autonomy, production mutation, secret handling, service-role-key location.
- Fitness/Factory confidence labels (Ops first; extend later if useful).

---

## Exact Commands Run

```
npm run build              # tsc, clean
npm run smoke:hosted       # 33 checks, all green (incl. 5 new transition-gate checks)
npm test                   # 2109 pass / 0 fail (8 new tests)
git diff … | grep <secret-patterns>   # no real secrets (only the test literal token)
git status --short
```

---

## Verification Summary

| Check | Result |
|-------|--------|
| TypeScript build | ✅ Clean (0 errors) |
| Tests | ✅ 2109 pass / 0 fail (was 2101; +8 new) |
| Smoke (`smoke:hosted`) | ✅ 33 checks green, incl. proposal-transition auth + fail-closed |
| Secret scan (diff) | ✅ Clean (only `smoke-secret-token-value` test literal) |
| Security gates touched | ❌ None |
| Approval flows changed | ❌ None |
| Production mutation | ❌ None |

### Files Changed
- `src/runtime/cloudflare-cockpit-views.ts` — proposal reasoning + view-only hygiene derivation
- `src/runtime/cloudflare-cockpit-page.ts` — proposalBox renders effect/why-approve/why-reject + hygiene banner
- `src/runtime/cloudflare-cockpit-worker.ts` — pass `now` to proposalsView (for expiry derivation)
- `src/cockpit/cockpit-intent-router.ts` — Ops confidence+source line; panelMissing 5-part recovery format
- `scripts/cockpit-cloudflare-smoke.ts` — proposal-transition auth + execution-gate fail-closed checks
- `tests/proposals-view-hygiene.test.ts` — NEW (7 tests: reasoning + dedup + expiry + absent-queue)
- `tests/cockpit-intent-router.test.ts` — +2 tests (ops confidence line, panelMissing recovery format)
- `package.json` — register new test file

### Branch / Commit
- Branch: `feat/agent-runtime-provision-18d`
- Commit: see `git log` (this patch follows `924c610`)

---

*System-quality sprint completed 2026-06-09. Push requires explicit Hart authorization.*
