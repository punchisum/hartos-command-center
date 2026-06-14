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
- **THE DECIDE→BUILD LOOP IS CLOSED + PROVEN** (PRs #51, #52, disarmed/propose-only). council→Factory
  bridge + a Claude-Max **concretize pass** (PR #52): a GO'd council plan → concretize (strategy +
  specialist findings → a concrete buildable HartOS AgentSpec, direct-spec path) → Factory manifest +
  build plan → a `build_agent_plan` proposal awaiting a SECOND GO (never scaffolds). **Ran live end-to-end
  on the GO'd M&A plan → produced `ma-signal-scout-agent`** (reads SEC EDGAR 13D/13G + news, scores
  acquisition likelihood; the Legal specialist's MNPI warning PROPAGATED into the spec — "no investment
  advice, requires_human_gate, disclaimer"). Full vision realized: goal → council → GO → concretize →
  Factory build plan → (second GO → gated runway).
- **Test suite:** 3200/0.

## Roadmap ahead

- **P7 — Multi-level agent orchestration + intelligence upgrade** (the "CRM-council": delegate → research /
  prophet / financial / CTO agents gather inputs → proposal for Hart to approve).
- **P8 — Reflexive learning loop** (consume the track record to recalibrate its own thresholds/rules).

---

## The build log

Five eras, 20 series, 2026-06-04 → 2026-06-14.

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
