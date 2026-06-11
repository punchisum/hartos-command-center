# HartOS — Autonomy Window Changelog (2026-06-11)

> Hart away ~2h, full BUILD→TEST→PUSH→DEPLOY→RUN-LIVE authority granted, with a safety floor.
> This file is the durable record of everything built / deployed / run so Hart can review + undo
> on return. Append-only during the window.

## Authority & floor (as granted)
- AUTO-EXEC = internal + reversible only (autoheal-gate invariant). ✅ honored.
- Irreversible / external stays gated → queued for Hart. ✅ honored.
- Green before deploy; verify /health SHA after each deploy. Kill-switch + rollback + audit intact.

## Verified starting baseline (read-only checks, 2026-06-11)
- **Branch:** `feat/agent-runtime-provision-18d`. HEAD `a9067ec` (Operation JARVIS doctrine doc).
- **Shared working tree** — pre-existing uncommitted changes NOT authored by this session (left untouched):
  `src/cockpit/suggestions/suggestion-to-mutation.ts`, `scripts/run-memory-heartbeat.cmd`, `tests/approved-executor.test.ts`.
  This session's files: `src/cockpit/decision-engine.ts`, `tests/decision-engine.test.ts`,
  `src/runtime/cloudflare-cockpit-worker.ts` (concierge block), `docs/HARTOS_HUMAN_OS_DOCTRINE.md`.
- **Cockpit Supabase project:** `xbuinrnpfjltimofwrdx` ("Hart Personal Core"). Spine tables present.
- **Proposal queue:** 10 rejected, 2 expired, 1 runtime_provisioned, 1 draft, 1 pending_approval.
  **No `approved_for_execution` / `executing` rows** → nothing external/irreversible queued to auto-fire.
- **Autonomy proven live:** audit shows internal-reversible auto-execs (`archive_rejected_executed`,
  `refresh_sync_executed`); zero external auto-execs ever. Last pulse 2026-06-10 12:44Z (GREEN).
- **Armed flags (.env.local):** internal-reversible autoheal fully armed (class + reject-drafts +
  archive-rejected + refresh-sync); kill-switch OFF (absent → reachable); Obsidian write armed.
  ⚠️ **FYI for Hart — external/irreversible exec flags also armed** (`ALLOW_EXEC_CLICKUP_COMMENT`,
  `ALLOW_EXEC_CLICKUP_MOVE`, `ALLOW_GITHUB_PUSH`, `CONFIRM_GITHUB_PR`, `ALLOW_CODE_BUILD`,
  `ALLOW_AUTO_ORCHESTRATE`). These cannot auto-fire via the pulse (autoheal class = internal only)
  and have nothing queued to act on, so they pose no unattended risk during this window. This
  session did NOT run any script that fires them. Consider disarming when convenient.

---

## Work log

### Phase 1 — Tier 0–4 risk-tiered autonomy (BUILT + GREEN + VERIFIED LOCALLY; NOT deployed)
Files authored this session:
- `src/doctrine/autoheal-invariant.ts` (NEW) — the pure single-source-of-truth for "what may auto-run
  unattended": the 3 internal-reversible adapter ids + class flag + invariant text. Zero deps (Worker-safe).
- `src/cockpit/decision-engine.ts` — now CONSUMES the autoheal invariant ("one gate, not two"): cites the
  autoheal-gate class flag in the Tier-1 risk line; adds `proposalTier` (AutonomyTier→ProposalTier T0..T4
  bridge) + `autohealGoverned`. No parallel gate.
- `src/runtime/cloudflare-cockpit-page.ts` — NEW `exceptionFeed()` at the top of Overview (command-by-
  exception face: "⚠ M need you" / "✓ All clear" + honest autonomy pulse line); reuses the existing gated
  `.pact/.pbtn` → `/api/proposals/transition` so Approve only AUTHORIZES (never fires external). Client
  `fmt()` extended to render the concierge (tier · what matters · next · risk) for typed Asks.
- `src/runtime/cloudflare-cockpit-worker.ts` — concierge block now also surfaces `proposalTier` + `autohealGoverned`.
- `tests/autoheal-invariant.test.ts` (NEW) — drift guard: invariant ids == autoheal-gate class ids; no external
  adapter is ever autoheal-eligible; autonomy↔proposal-tier map is total/risk-ordered.
- `docs/HARTOS_HUMAN_OS_DOCTRINE.md` (NEW, earlier this session) — the product doctrine (sits above the
  CI-enforced safety constitution; never weakens it).

Verification (read-only, allowed):
- `npm run build` clean. **Full suite 2494/0** (was 2490; +4 new). doctrine-conformance still green
  (Worker stays `ACTION_EXECUTION="disabled"`, no mutation endpoints — constitution untouched).
- Rendered the hosted page locally: Exception Feed present, calm all-clear state, autonomy pulse line +
  verdict surfaced, read-only footer + `app2` shell intact.

### ⛔ BLOCKED — live pulse + deploy require Hart's explicit approval
- `npm run hartos:autopilot` (live pulse) was **DENIED by the harness permission layer**: it mutates the
  shared production Supabase queue, and the standing CLAUDE.md boundary ("no deploy/mutate without explicit
  approval") is NOT lifted by a cross-session handoff message. I did **not** work around it.
- By the same boundary, `wrangler deploy` and `git push` are expected to be denied, so I did **not** attempt
  them. **Nothing was deployed; the live cockpit is unchanged; no Supabase rows were mutated by this session.**
- The autonomy loop itself remains armed + proven (last real auto-exec 2026-06-10); this session simply did
  not trigger it.

### To go live once approved (in-session approval, or add Bash/deploy permission rules)
1. `npm test` (confirm 2494/0 green on the shared tree at that moment).
2. Live pulse (internal-reversible only): `npm run hartos:autopilot` — then verify in Supabase
   `xbuinrnpfjltimofwrdx`: new `cockpit_proposal_audit` exec rows, a fresh `cockpit_pulse_runs` row, and a
   new note in the Obsidian vault.
3. Deploy the read-only cockpit (with Exception Feed + concierge):
   `npx wrangler deploy --config wrangler.cockpit.toml --var BUILD_SHA:$(git rev-parse --short HEAD) --var BUILD_TIME:<iso>`
4. Verify `/health` returns the new `version` SHA. Rollback = `wrangler rollback` or redeploy the prior SHA.

### Phase 2 (COP fleet-map) — interactive increment BUILT + GREEN (commit pending below)
After Hart's "proceed", the live pulse/deploy were denied AGAIN by the harness (a bare "proceed" is not the
precise approval the auto-mode classifier requires for production-mutating actions — it needs a Bash
permission rule in settings). So I did the allowed, high-value increment instead:
- `src/runtime/views/cockpit-v3-fx.ts` — the Fleet Network SVG is now an interactive COP: every node is
  clickable + keyboard-focusable (`data-agent`, `role=button`, `tabindex`, `<title>`) and opens that agent's
  console drawer; degraded nodes (amber/red) breathe (exception-bright), reduced-motion-safe; pinned `node`/
  `edge`/`flow` classes preserved.
- `src/runtime/cloudflare-cockpit-page.ts` — node click/Enter handler wired to the existing `openDrawer`.
- Verified locally: nodes carry the interactive attributes; full suite 2494/0.
- DELIBERATELY NOT built blind: activity-driven edge pulses + per-node exception COUNTS plotted spatially —
  those want live data, best done after deploy. Node-level status already renders the exception state.

### ⛔ Still blocked: live pulse + deploy (needs a settings permission rule, not chat approval)
The auto-mode classifier denies `npm run hartos:autopilot` and (by the same boundary) `wrangler deploy` even
after "proceed". To unblock, add Bash permission allow-rules for those commands in
`.claude/settings.local.json` (or approve the specific permission prompt interactively), then run the
"To go live once approved" steps above. I did not self-grant these permissions.
