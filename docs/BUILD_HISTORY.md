# HartOS — Build History

The canonical, chronological record of what HartOS is and how it got here — series by series.
This is a living log: **append new series at the bottom of the relevant era (or start a new era), keep
the table format, and update "Current state" + "Roadmap ahead" as milestones land.**

> One line: in ~10 days HartOS went from a read-only cockpit to a system that **perceives, proposes,
> executes behind gates, rolls itself back, and edits + ships its own code autonomously** — with the
> safety net proven on a failed attempt before the first success landed.

---

## Current state (as of 2026-06-14)

- **P6 — Bounded Autonomous Self-Modification: LIVE and PROVEN.** First autonomous fix→deploy is commit
  `e073ceb` (added `GET /api/agents` to the cockpit's route contract), gauntlet-verified and deployed
  to the live worker. The first armed run failed-closed (no bad deploy) and surfaced 2 machinery bugs,
  both fixed (PR #44) before the clean green run.
- **Trunk:** `feat/cloudflare-hosted-command-center`. **Live worker:** `https://hartos-command-center.hartos.workers.dev`
  (`/health` reports the deployed `BUILD_SHA`; `actionExecution:"disabled"` — the public Worker fence holds).
- **Daemon:** local `live-runner`, fully armed, idle until a task is queued. Kill-switch
  (`HARTOS_EXECUTION_KILL_SWITCH=on`) overrides everything.
- **P7 — the Council: CODE-COMPLETE + WIRED + DISARMED.** Plans 1–3 + wiring merged (PRs #45–#48) —
  `src/council/` + cockpit: arming gate, 5-specialist roster, panel selection, no-laundering synthesis,
  recursive coordinator, governed `council_specialist` LLM path, real Research brain, **Claude-on-Max
  infer** (concurrency-capped), `createCouncilProposal`, `council.orchestrate` job, cockpit view +
  `GET /api/council` + P8 memory signal. Propose-only; arming (`HARTOS_ALLOW_COUNCIL`) is Hart's gate.
  **Real local-agent run SUCCEEDED + PERSISTED a proposal** (2026-06-14, PR #49) — `run-council-pass.js`
  armed → 6 specialists (CTO/Financial/M&A/Legal on Claude-on-Max + Beezulbub + Research) → a real
  `CouncilProposal` in the cockpit (`prop-council-2026-06-14T06-59-26-651Z`, pending_approval) on goal
  "M&A Intelligence Agent". Also added: **Claude-Max as the host-side gateway primary** (Gemini fallback;
  Worker bundle stays clean), **Beezulbub as a council brain**, full-gather + honest-degrade (PR #50),
  and the **Worker→Claude-Max routing design** (async Supabase relay). Hart GO'd the M&A proposal.
- **Worker→Claude-Max relay: LIVE + VERIFIED end-to-end on Claude-Max** (PR #53 + activated 2026-06-14).
  The cockpit Ask now routes to Claude-on-Max via an async Supabase relay (`ask_requests` table +
  `relay-ask` Edge Function + a daemon ask-relay sub-pass; `HARTOS_ASK_VIA_RELAY` + `HARTOS_ASK_RELAY`
  armed) — daemon never exposed, silent Gemini fallback if it's offline. Proven: a live relay row came
  back `provider=claude-max` (after two `claude-max-provider` fixes — use a Claude `--model`, not the
  gateway's `HARTOS_LLM_MODEL=gpt-5.5`; and strip Claude's ```json fence before parsing). Claude-Max is
  now HartOS's brain end-to-end — host AND edge.
- **THE DECIDE→BUILD LOOP IS CLOSED + PROVEN** (PRs #51, #52, disarmed/propose-only). council→Factory
  bridge + a Claude-Max **concretize pass** (PR #52): a GO'd council plan → concretize (strategy +
  specialist findings → a concrete buildable HartOS AgentSpec, direct-spec path) → Factory manifest +
  build plan → a `build_agent_plan` proposal awaiting a SECOND GO (never scaffolds). **Ran live end-to-end
  on the GO'd M&A plan → produced `ma-signal-scout-agent`** (reads SEC EDGAR 13D/13G + news, scores
  acquisition likelihood; the Legal specialist's MNPI warning PROPAGATED into the spec — "no investment
  advice, requires_human_gate, disclaimer"). Full vision realized: goal → council → GO → concretize →
  Factory build plan → (second GO → gated runway).
- **P8 — Reflexive Learning Loop (council-calibration slice): CODE-COMPLETE + DISARMED.** HartOS now
  aggregates Hart's approve/reject on council proposals into a per-band approval rate and, on a
  well-evidenced delta, **enqueues a `recalibrate` self-mod task** that rewrites one council constant
  (`COUNCIL_BAND_APPROVAL`) through the §6 gauntlet. The applied calibration is **demote-only** (it can
  only present a band lower than the §19 raw band — never inflate), so the loop can only make HartOS more
  conservative about itself. Pure aggregate + decide (never throws), responsive tuning (min-sample 4 /
  deadband 0.05 / step 0.20), two independent locks both default-off (`HARTOS_ALLOW_LEARNING` to enqueue;
  the self-mod triple to apply), wired into the live-runner at a ~1h cadence. Adds **zero** new execution
  surface — it writes the same queue the proven §6 gauntlet already governs.
- **Cockpit correctness + truth-layer Phase A (2026-06-14).** Fixed Hart's reported drifts: fleet
  health is now a health+freshness **composite** (was a misleading ~19%); Ask `infer-threw` hardened
  (gateway construction can't throw) + relay arming surfaced; Factory/Wolverine/Beezulbub status
  corrected to **live** with a kill-switch-aware downgrade; **Sentinel auto-engages Wolverine** on a
  down/stale agent (advisory, gated); **Live Ops now tracks approved council + factory-build work**
  (an approved M&A proposal no longer vanishes) with a truth-safe firing rule. Plus the ratified
  **dynamic-agent-registration constitution** → truth-layer **Phase A**: `AgentManifest` +
  `deriveAgentStatus` (status derived from lifecycle + liveness + arming; nothing "live" without a
  confirming heartbeat), a pure `agentRegistryView`, an 18-organ seed, the `agent_registry` migration
  (designed, not applied), and a live `GET /api/agent-registry`. Built via an ultracode workflow
  (contract → parallel impl → adversarial review). Phase B (swap the v5 deck onto the registry view)
  is next. Design: `docs/superpowers/specs/2026-06-14-dynamic-agent-registration-cockpit.md`.
- **Test suite:** 3284/0.

## Roadmap ahead

- **P8 slice 2 — action-efficacy calibration** (`cockpit_decision_outcomes` → did executed fixes resolve
  their target? → tune proposer severity/confidence thresholds), reusing the same enqueue→§6 mechanism.
- **Beyond:** panel-aware council calibration (learn which specialist combinations Hart trusts), and
  surfacing which brain answered each cockpit Ask.

---

## The build log

Seven eras, 22 series, 2026-06-04 → 2026-06-14.

### Era 1 — Foundation (Jun 4–6) · the spine, the runway, the law

| # | Series | What it does | When |
|---|--------|--------------|------|
| 1 | Cockpit Foundation (Ph 1–16D) | Local + hosted read-only command center; live Fitness & Ops read-models | Jun 4 |
| 2 | Agent Creation / Factory Runway (Ph 17–18) | Plan → scaffold → PR → gated data + runtime provisioning (first external mutations) | Jun 4–5 |
| 3 | Shared Doctrine v1 | The constitution-as-code — the governing rules every agent obeys | Jun 6 |

### Era 2 — Depth & Intelligence (Jun 7–8) · it starts to perceive and reason

| # | Series | What it does | When |
|---|--------|--------------|------|
| 4 | Cockpit Depth (Workstream C–E) | Fleet signals, per-agent read-models, Supabase proposal spine, Ask-HartOS CTO brain | Jun 7–8 |
| 5 | Intelligence Cores (F1–F5) | Research planner, Rinnegan perception, Fleet OS + Orchestrator + Prophet forecast | Jun 8 |
| 6 | Governance Spine (Ph 0–4) | Doctrine-as-code, fail-closed gates, approval UI + audit, execution adapters, officiation | Jun 8 |

### Era 3 — Integration & Brains (Jun 9–10) · the loops close, the knowledge accrues

| # | Series | What it does | When |
|---|--------|--------------|------|
| 7 | 3 Levels Up (3LU) | Factory Agent, Mutation Center, Fleet Brain, Beezulbub, LLM Ask, ClickUp adapters | Jun 9 |
| 8 | UX / Quality + Cockpit v2 | Quality/awareness/memory patches + Executive-OS redesign + "approve → it moves" | Jun 9 |
| 9 | Wolverine | Self-audit → ranked FixProposal repair loop → guardrail-drift detectors | Jun 10 |
| 10 | Knowledge Loop | Obsidian vault + context compiler + Beezulbub scout + live Research Agent | Jun 10 |
| 11 | Organism (P0–P11) | Meta-agent registry + command router + agent-status split | Jun 10 |

### Era 4 — Autonomy Live (Jun 10–13) · the daemon, the senses, the hand

| # | Series | What it does | When |
|---|--------|--------------|------|
| 12 | Autonomy Spine + Tiers (T1–T6) | Gated jobs + runner + autopilot; autoheal, reports, learning loop, orchestration, builder, data-gen | Jun 10–11 |
| 13 | Sentinel + Alerting | 24/7 heartbeat + liveness, Telegram approvals, alert bus, dead-man's-switch | Jun 11–12 |
| 14 | Cockpit Skins (V2–V5) | Executive OS → JARVIS → SYNAPSE → Flight Bridge → Neural Deck | Jun 9–12 |
| 15 | Execution Hand (W1–W3) | `claude.execute` CLI hand + spec-interrogation gate + git-baseline / tool-scope / audit hardening | Jun 12–13 |
| 16 | Truth Layer + CI Gate | `/health` reports the live commit SHA; CI hard-gates the deploy | Jun 12–13 |

### Era 5 — The Autonomy P-series (Jun 13–14) · verify → undo → act → rewrite itself

| # | Series | What it does | When |
|---|--------|--------------|------|
| 17 | P3 — Post-Execution Verification | Verify writes actually landed + persist verdict + idempotency-replay guard | Jun 13 |
| 18 | P4 — Rollback | Inverse-command derivation + rollback execution + cockpit Rollback button | Jun 13 |
| 19 | P5 — Autonomous Fitness Mutations | The hand inside the fence: derive → materialize → ingest → poll → apply, live | Jun 13 |
| 20 | **P6 — Bounded Self-Modification ★ LIVE** | §6 constitution + full gauntlet + auto-deploy net — first autonomous fix→deploy (`e073ceb`) | Jun 13–14 |

### Era 6 — Orchestration (Jun 14 →) · many minds, one proposal

| # | Series | What it does | When |
|---|--------|--------------|------|
| 21 | P7 — Multi-Level Agent Orchestration ("the Council") · *code-complete, disarmed* | Recursive coordinator convenes a panel of specialists (Research/CTO/Financial/M&A/Legal) + sub-coordinators → synthesizes ONE proposal with dissent surfaced. Propose-only, gated. **Plans 1–3 merged** (kernel + recursion + live wiring + cockpit + P8 memory signal); arming is Hart's gate | Jun 14 |

### Era 7 — Reflexive learning (Jun 14 →) · it tunes itself from its own track record

| # | Series | What it does | When |
|---|--------|--------------|------|
| 22 | P8 — Reflexive Learning Loop · council-calibration · *code-complete, disarmed* | Aggregates Hart's approve/reject on council proposals into a per-band approval rate, then recalibrates one council constant (`COUNCIL_BAND_APPROVAL`) **through the §6 self-mod gauntlet** — demote-only, so it can only ever make the council more conservative (§19 intact). Adds zero execution surface; gated behind `HARTOS_ALLOW_LEARNING` (separate from the self-mod triple) | Jun 14 |

---

## Key milestones

- **Jun 5** — first gated **external mutation** (GitHub PR + live Supabase apply via the Factory runway).
- **Jun 6** — **Shared Doctrine v1** ratified as code (the governing law).
- **Jun 10** — **autonomy goes live**: gated agent-job spine + runner + autopilot pulse; Wolverine repair loop.
- **Jun 13** — **P5**: HartOS autonomously mutates a real domain (fitness) inside the fence.
- **Jun 14** — **P6**: HartOS edits its own source and ships it to production, autonomously, behind the gauntlet.

## How to add to this log

1. Land the work (PRs as usual), then add a row to the relevant era table — or open a new `### Era N`
   section if it's a new chapter.
2. Keep the columns: **# · Series · What it does (one line) · When (date or range)**.
3. If it's a numbered series (P*, T*, W*, F*, Phase *), keep the prefix so the lineage stays legible.
4. Move anything newly-live into **Current state** and prune it from **Roadmap ahead**.
5. Add a bullet under **Key milestones** only for genuine firsts / step-changes, not routine increments.

🤖 Maintained with [Claude Code](https://claude.com/claude-code)
