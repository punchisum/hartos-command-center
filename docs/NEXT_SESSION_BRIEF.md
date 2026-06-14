# HartOS — Next Session Brief (authored 2026-06-14, end of session)

> **Read this FIRST. Then INTERVIEW Hart before doing anything.** Do not start building, do not
> trust the optimistic status memories, do not believe any doc/markdown/memory that says
> "LIVE/ARMED/DEPLOYED" until you have checked the **actual source of truth** (Supabase rows,
> Cloudflare worker list, daemon heartbeat, git log, filesystem). Doctrine §: *done = observable in
> the truth layer.* By that standard, most of HartOS is NOT done.

---

## 0. Prime directive for the next session

**Ground every claim in rows, not prose.** A 2026-06-14 reality audit (pasted by Hart, reproduced in
§4) checked the database and downgraded almost everything the memories assert. The memory files in
`memory/` (P6 self-mod "LIVE+PROVEN", P7 council, P8, dynamic-agent-registration "Phase A built") all
**overstate liveness** versus what the tables actually contain. Treat them as "code that exists,"
NOT "behavior that runs." When in doubt, query the table.

## 1. INTERVIEW HART FIRST (he asked for this explicitly)

Before any work, ask Hart — one question at a time — to set direction. Suggested questions (pick/adapt):

1. **North star:** Is the goal to make HartOS *genuinely* autonomous (move the daemon to the cloud,
   populate the registry from real events, fire one external execution end-to-end), or to make the
   cockpit *honestly* reflect the modest reality (drive the UI from rows, render empty when empty)?
2. **First proof:** Which ONE capability do you want to make truly real next — (a) one external
   execution adapter fired + verified, (b) the cockpit fleet driven from `agents`/`agent_registry`
   instead of the hardcoded catalog, (c) the daemon on durable cloud infra, or (d) the
   verification/learning loop actually writing `cockpit_decision_outcomes`?
3. **Theater tolerance:** Do you want me to *delete/guard* the theater surfaces (fleet org-chart,
   "live" badges, dead `/api/factory-job`) now, or leave them until their backing data exists?
4. **Cleanup now?** Kill the runaway `wolverine.audit` loop (§3 #1) and purge the dead proposal this
   session? (Safe, internal-only, ~16,985 audit rows and growing ~6,600/day.)
5. **Honesty pass:** Should I rewrite the status memories to match the truth layer (the
   `hartos-reality-baseline` memory already starts this)?

Do NOT proceed to building until Hart answers #1 and #2.

## 2. The one-paragraph reality (from the audit)

HartOS today = one genuinely-live **fitness data pipeline** (separate repo `hart-os-fitness-trigger`
+ webhook worker), one separate live **GECAN ops** system HartOS only *reads*, a **read-only
auth-gated cockpit** (worker `hartos-command-center`, version = git HEAD, `actionExecution:disabled`),
and a **polling daemon on Hart's desktop** (PID-bound). Wrapped around this is a **hand-authored
18-node "organism" that does not exist in the source of truth**: `agents` table = **1 row**
(fitness), `agent_registry` = **0 rows**, `cockpit_decision_outcomes` = **0 rows**,
`agent_audit_log` = **0 rows**. The single most active behavior in the system is a **2-day-old bug
re-logging the same skipped proposal ~16,985 times**. HartOS has **never** verifiably mutated any
external system, **never** autonomously modified+kept its own code, and its verification layer is
empty — so by its own doctrine almost nothing is "done."

**Scoreboard:** LIVE = fitness pipeline, GECAN (separate, read-only to HartOS), cockpit read layer,
daemon (desktop-bound), in-Worker Ask synthesis (read-only/propose-only), internal `archive-rejected`
(the only real side-effect ever). PARTIAL = Council (real reasoning, zero downstream value), Ops
projection, Prophet (dead pulse). THEATER = the fleet/org-chart/connectome UI, `/api/agents` +
`/api/agent-registry` (hardcoded `CATALOG` + `SEED_AGENT_MANIFESTS`, registry table unread),
all external execution (ClickUp, fitness hand, never fired once), self-modification, the
verification/learning loop, the "deployed tax-agent" (worker doesn't exist). DEMO (script-only, not
in a live loop) = Wolverine, Beezulbub, Research, Factory-build, Officiator/Simulator.

## 3. Top truth-blocking issues — the real backlog (supersedes the old task list)

1. **Daemon is desktop-bound** (Node PID on Hart's PC reading `.env.local`). If the PC sleeps, the
   "organism" dies; only the read-only worker + the two external webhooks survive. → move `live-runner`
   to durable cloud infra (the single biggest realness gap).
2. **Runaway `wolverine.audit` loop** — a structural refusal marks the job re-runnable, re-logging
   forever (~6,600 audit rows/day, 16,970 of 16,985 audit rows = this one bug). → mark terminal +
   purge the dead proposal. (Offer to do this immediately; safe, internal.)
3. **Verification layer is empty** (`cockpit_decision_outcomes`=0, `agent_audit_log`=0). Nothing ever
   measures whether an executed/approved thing panned out. → write outcomes on real events (this is
   P8's actual precondition — P8 calibration has nothing to learn from until this is non-empty).
4. **Cockpit shows a fleet that doesn't exist.** `/api/agents` + the v5 connectome render from two
   hand-typed TS arrays. → **Phase B**: drive the UI from `agents`/`agent_registry` rows; render empty
   when empty; **delete the hardcoded "live" badges** (this session's status-label fix is the theater
   the audit flags — undo or row-back it).
5. **`agent_registry` has 0 rows.** Phase A (this session) built the table + RPC + `agentRegistryView`
   + `/api/agent-registry` but **no writer populates it** and the v5 deck never reads it. → either
   register agents on real events (Factory writes a manifest on Synapse approval) **or delete the
   surface**. Do not ship more empty substrate.
6. **Zero external execution, ever.** Prove ONE adapter end-to-end (ClickUp comment is the safest):
   arm → propose → approve → execute → **read back the comment from ClickUp** → write the outcome.
7. **Fitness mutation "hand" isn't wired into the daemon executor** (`run-spine-executor.ts` omits it),
   so the flagship autonomy loop can't fire even when armed (`HARTOS_ALLOW_FITNESS_ADJUST=true`).
8. **Self-modification has never completed autonomously.** The "first autonomous fix→deploy" commit
   (`e073ceb`) was authored by `Hart Pun <punchisum@gmail.com>` and added one string to a routes
   array. Stop counting it as autonomy; gate the claim behind a bot-authored, verified, kept,
   auto-reverted-on-failure change. (Correct the `hartos-p6-self-mod-status` memory.)
9. **"Agents" are scripts, not services.** Wolverine/Research/Beezulbub/Council/Factory run only when
   Hart types a `scripts/*` command. A real OS schedules + supervises them.
10. **Memory/docs overstate reality.** Derive status from rows. See `hartos-reality-baseline` memory.

## 4. Remaining build tasks from this session (re-framed, NOT to be done before the interview)

- **P8 — reflexive learning loop (council-calibration slice):** CODE-COMPLETE + disarmed, but its
  input (`cockpit_decision_outcomes`/decided council runs) is ~empty, so it has nothing to learn from.
  **Precondition = issue #3.** Don't arm it until outcomes exist.
- **Truth-layer Phase B:** swap the v5 deck off the hardcoded `CATALOG` onto `agentRegistryView` +
  source manifests from `hartos_list_agent_registry()` RPC (migration applied this session, table
  empty); have the Factory write a manifest on Synapse approval. **This is issue #4/#5 — the honesty fix.**
- **Cockpit fixes shipped this session (live on worker `b79e5d4`):** fleet-health composite, Ask
  `infer-threw` hardening, Live Ops building tracker, Sentinel→Wolverine advisory pass. These are real
  read-layer improvements — but the status-label "live" change is theater per the audit (#4).

## 5. What is genuinely production-grade (don't break these)

Fitness data pipeline (separate worker, fresh real data, real approval queue) · GECAN ops (separate,
syncing every minute) · the **fail-closed execution gating** architecture (audit-before-execute,
per-action `ALLOW_EXEC_*` flags, kill-switch, idempotency — real engineering, just never exercised
externally) · cockpit read layer + auth (fails closed on 401) · Council's honest no-laundering
synthesis · dead-man's-switch + Telegram alerting.

## 6. Loose ends from this session (for the next session to close)

- **Fitness nutrition bot fix DEPLOYED** (`hart-os-fitness-trigger` `0cc460fd`, trigger.dev version
  `20260614.1`): text `/log` now prefers Gemini (OpenAI account is out of credit → was falling back to
  a crude `350 kcal` default for everything). **REMAINING MANUAL STEP:** Hart must set, in the
  trigger.dev dashboard (project Fitness Agent V4, `proj_esipxunwkrxrhuiabkkg`, **prod** env):
  `GEMINI_API_KEY=<his Gemini key>` and `VISION_PROVIDER=auto`. Until then the deployed code still
  falls back to dead OpenAI. Verify with `/log ice cream` → real estimate, not `350/18/35/12`.
- **OpenAI account is out of paid credit** (`429 insufficient_quota`) — this also starves the cockpit
  Ask's OpenAI fallback. Either top up OpenAI or confirm Gemini-primary everywhere.
- **P8 / Phase B tasks** remain in the task list (#22 Phase B). Do not advance them before the interview.

---

*Authored at session close 2026-06-14. The honest framing here matters more than the build progress:
HartOS's foundations are real; its autonomy/fleet/execution/self-mod/learning layers are presented as
operational while the source of truth shows them dormant, empty, or dead. Fix the presentation OR fix
the reality — but stop shipping the gap.*
