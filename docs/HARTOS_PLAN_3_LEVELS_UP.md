# HartOS — "3 Levels Up" Implementation Plan (~20h, 2 sessions)

**Status:** APPROVED by Hart 2026-06-08 (full integrated build).
**Builds on:** the "to 80%" plan (`docs/HARTOS_IMPLEMENTATION_PLAN_TO_80.md`). Phases 0–3 deployed;
Phase 3 canary **fired + proven** 2026-06-08 (first real safe execution); Phase 4.1 (auto-PR +
monitoring archetype) and 4.2 (officiation core) done as *mechanisms*, not yet live end-to-end.

**This plan = finish Phase 4 + three new capability asks** (LLM in "Ask HartOS", voice chat seed,
agent creation 0→100) **+ fleet intelligence.**

## North star
A spec becomes a **deployed, live, officiated** agent reading real data and proposing; you **talk**
to HartOS (voice) and it **reasons** (LLM); the fleet **triages itself** into a prioritized briefing;
**multiple safe actions** execute through one gate — all under the **unchanged human-approval floor**.

## The ladder
| | State |
|---|---|
| **L0 — now** | Gated fleet, one proven action. Created agents don't auto-light-up live; single-action human-fired execution; no fleet reasoning. |
| **L1** | Agent creation **0→100** — spec → provisioned → deployed → officiated live → reading data → proposing. |
| **L2** | HartOS **talks back** — LLM-powered "Ask HartOS" + voice chat seed. |
| **L3** | **Fleet intelligence** + gated multi-action execution (typed-task spine + autonomy loop). |

---

## Pre-flight hardening (~0.5h) — close tonight's open follow-ups
- **Strict TLS for the DB executor** — supply the Supabase CA so `createRefreshSyncDb` connects
  `strict` (kills the `relaxed ⚠` warning). File: `src/execution/run-refresh-sync-db.ts`.
- **Server-side row-status verification** — `execution-gate` verifies the live proposal row status
  instead of trusting the asserted `approved_for_execution`. Files: `src/doctrine/execution-gate.ts`
  + a read in the executor. (Required before any unattended execution.)

---

## LEVEL 1 — Agent creation, 0 → 100 (~7h)
**Goal:** a spec runs the whole pipeline: scaffold → **gated provision of real infra** → deploy →
**officiated live** in the cockpit → reads real data → proposes. Most machinery already exists
(`hartos-agent-factory/templates/runtime/src/provisioning/*`, `launch/*`; `scripts/agent-runtime-provision.ts`,
`scripts/agent-data-provision.ts`) — the work is wiring it into one **gated, officiated** flow and
proving it on a real agent.

- **1A — Gated provisioning + launch into the create→officiate pipeline (~3h).** Sequence the
  existing provisioning/launch adapters behind per-step approval gates; surface status in the cockpit.
- **1B — Live officiation (~3h):**
  - Cockpit Worker **loads created-agent contracts** from an anon-readable `cockpit_agents` source
    (Node-writes / Worker-reads-anon, mirroring the proposal spine) → fleet card + `/agent/<type>/ui`
    from declaration. Files: `src/runtime/cloudflare-cockpit-worker.ts`, `cloudflare-cockpit-page.ts`,
    `src/agents/officiation.ts`.
  - **Generic "other" read-model, live** — a created agent's `ReadModelConfig` → banded
    `ReadModelSummary` → `AgentSignal`. File: `src/runtime/cloudflare-live-read-models.ts`.
  - **Backport the officiation seam** (`agent-signal` + `agent-contract` + `officiation`) into
    `hartos-agent-factory/templates/runtime/src` so generated agents self-officiate. Factory tests.
- **1C — Birth ONE real agent end-to-end (~1h + approval gates):** scaffold → provision → deploy →
  officiate → verify the card + detail page + a propose-only proposal, live.

**DoD:** describe a domain → a **deployed, live, officiated** agent reading a real RPC — not a skeleton.
**Honest limit:** "100" = the pipeline runs to the end, but each **irreversible/outward step
(create cloud project, deploy, spend) stays behind explicit approval.** Real provisioning costs money
and is hard to undo. Automated assembly, human-fired consequential steps — not type-and-walk-away.
Born agents are **read-only monitors** (no external mutation yet).

---

## LEVEL 2 — HartOS talks back: LLM Ask + voice (~5h)
- **2A — LLM into "Ask HartOS" (~2.5h).** Wire the existing gateway (`llm-*`: provider-select,
  **redaction**, output-validation, usage-log) into the Ask handler so the verdict/strategy is
  **reasoned**, not pure rule-based. Secrets redacted before any prompt; output validated; usage
  logged; **honest "rule-based mode" fallback** when the LLM is off (Phase 1.2); behind a flag.
  Files: the Ask path in `src/runtime/cloudflare-cockpit-worker.ts` + `scripts/cockpit-ask.ts`.
- **2B — Voice chat seed (~2.5h).** A mic button in the cockpit → speech-to-text → "Ask HartOS" →
  spoken answer (TTS). Cockpit page JS (Web Speech API). **Input-only.**

**DoD:** ask HartOS a strategic question in plain language — by voice — and get a reasoned,
risk-rated answer.
**Honest limits:** voice can **ask, not approve/execute** — the approval floor stays a deliberate
click, never a spoken command. Browser STT may route audio through a third party — flagged, opt-in.

---

## LEVEL 3 — Fleet intelligence + gated multi-action (~7h)
The original L2+L3, now **LLM-capable** by reusing L2's gateway.
- **3A — Fleet synthesizer brain (~2.5h).** All `AgentSignal`s + open proposals + recent audit →
  a **prioritized, risk-rated briefing** ("what needs you, in order, why"). Carries each input's
  freshness/confidence forward; never inflates (synthesis-must-not-launder-confidence). Rule-first;
  LLM optional via the gateway. Pure + tested.
- **3B — Typed-task spine + 2 more adapters (~2.5h).** An `agent_tasks` table + typed task contract
  (type/inputs/status/result/audit) + task-type→adapter routing; two more reversible allowlisted
  actions (e.g. `archive-resolved`, `re-surface`) behind the same gate. Node-writes/Worker-reads-anon.
- **3C — Gated autonomy loop + cockpit panel + e2e (~2h).** Signals → typed tasks → adapter,
  **stops at approval** (tests prove it can never self-approve). Kill-switch + flag default off.
  "Fleet Intelligence" panel renders the briefing live.

**DoD:** open one screen → whole fleet triaged + reasoned; approve a short queue; one approved task
executes through the hardened gate.

---

## Two-session split
- **Session 1 (~10h):** Pre-flight hardening + **L1 (0→100 creation)** + **2A (LLM Ask)**.
  → *born agents + a smart Ask.*
- **Session 2 (~10h):** **2B (voice)** + **L3 (intelligence + spine + adapters + loop)**.
  → *voice + a fleet brain + multi-action.*

## Doctrine guards (so "more" ≠ "looser")
- **LLM advises, never acts** — reasons into proposals; propose-don't-act + approval floor untouched;
  no secret reaches a prompt (redaction); honest fallback when AI is off.
- **Voice is input-only** — asks/surfaces; never approves or fires.
- **Provisioning stays gated + irreversibility/cost-flagged** — every live resource/deploy/spend is
  Hart's call, like the Phase 3 canary.
- **The floor never moves.** "3 levels up" = more closed-loop, more conversational, more intelligent —
  Hart stays the pilot.

## Cadence
Per block: build → test → **Hart approves deploy** → verify live → next. Prod deploys, migrations,
and any new live write path need explicit per-action approval (the auto-mode classifier enforces this).

## Honest limits at the end of all 20h
- Born agents are **read-only monitors** — no external-system mutation (ClickUp/Telegram/money) yet.
- Execution stays **safe, reversible, internal**.
- Fleet intelligence is a **first cut** — no learning/self-calibration over time yet.
- An agent is only as good as the **real read-only RPC** it's pointed at.
