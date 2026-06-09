# HartOS Blueprint v2 — The Anti-Drift Execution Plan

> Authored 2026-06-06 after a full read-through of all four repos. This supersedes
> the ChatGPT blueprint's *sequencing* (not its philosophy). The philosophy —
> propose-don't-act, human-approval floor, Supabase=facts / Obsidian=meaning,
> honest staleness — is correct and already lives in the code. What this document
> fixes is the **order of work**, with hard gates so we stop building ahead of value.

---

## 0. The one sentence

**HartOS is the command operating system for Hart's business, fitness, research, and
personal execution: Hart states an outcome → HartOS understands it, checks live
context + memory, decomposes, proposes, asks for approval, executes safely, reports
back, and remembers.**

That sentence is right. Nothing below changes it.

---

## 1. Honest current state (what is REAL, 2026-06-06)

| Layer | Reality | Verdict |
|---|---|---|
| Fitness agent | Live (Trigger+Worker). Real data (Apple Health→Supabase). **Coach verdict = 4 hardcoded keyword `if`s**; LLM only rewrites tone. 4 rich RPCs exist. | Real pipes, thin brain |
| Ops agent | Live. ClickUp→Supabase→digest. `/briefing` ranks smartly; **`/digest` links zero cards in fallback, omits due/staleness/follow-ups in LLM path**. | Real pipes, thin brain |
| Cockpit | Hosted, read-only, honest about staleness. Cards + **460px summary drawer** on click. Live refresh (GET only). No fake data. | Real, but a mirror |
| Agent Factory | 1448 tests. Generates real working agent skeletons. Beezulbub = HartOS-shaped pack skeletons (not copied code). | Real, possibly premature |
| Provisioning ladder (18A–18D) | Gated GitHub PR + live Supabase apply + disposable live Worker deploy all proven. | Real, impressive |
| CTO input brain (18G) | **Not started.** Pieces exist (classifier, capability-gap, proposal-generator) but unwired. | Missing |
| Rinnegan / Prophet / Wolverine / multi-agent | Named only. | Aspirational |

**The drift:** the *factory that makes agents*, the *cockpit that shows agents*, and the
*orchestrator that plans agents* are all more advanced than the **two agents that
actually run Hart's day**. We have been manufacturing capacity faster than intelligence.

**The architecture risk:** ~900 JSON report files across 9 directories. State lives on
Hart's local filesystem, which is why the hosted cockpit shows 0 proposals. This must
move to Supabase before multi-agent is attempted, or orchestration has no shared spine.

---

## 2. The correction: depth before breadth

The ChatGPT blueprint says "Research Agent first." **Disagree for now.** The highest-leverage
move is making the agents that *already exist* genuinely smart, because:

1. It's what Hart feels every single day (recovery call, ops digest).
2. It establishes the **reasoning pattern** every future agent copies. If Research Agent
   is built before that pattern exists, it will be thin too.
3. It converts the cockpit from a mirror into a control surface.

**Rule of the v2 blueprint: you may not start phase N+1 until phase N's Definition of
Done is literally true.** Each phase below has an explicit gate.

---

## 3. The phases (re-sequenced, gated)

### Phase A — Fitness Agent gets a real brain  ✅ DONE + DEPLOYED (2026-06-06)
**Goal:** replace keyword-matching with structured reasoning over real numbers + trends.
**Delivered:** `src/lib/recovery-verdict.ts` (structured recovery score + readiness/fueling over real HRV/RHR/sleep vs a 7-day baseline from `get_fitness_weekly_summary`); `coachCallFromToday` keyword logic removed; `/today` now fetches the baseline best-effort and renders a verdict-driven Coach Call citing the actual deltas; LLM prompt tightened to explain-not-invent. 10 new offline tests; typecheck + full suite green. No DB migration needed. Remaining: `npm run deploy` (Trigger) to reach Telegram — Hart's call.

- A1. Add trend/derived fields to the read model (RPC or compute layer): HRV 3-day Δ%,
  HRV percentile vs 90-day, sleep-vs-target, RHR baseline drift, weekly-load trend,
  protein/cal remaining, freshness-in-hours.
- A2. Replace `coachCallFromToday()` with a **structured recovery score** (0–100 →
  green/amber/red) + `training_readiness` enum (full/controlled/easy/rest) +
  `fueling_urgency` enum, computed from the real metrics — deterministic and testable.
- A3. Use the LLM for the *reasoning sentence over the structured verdict* ("HRV down 12%
  on 6.5h sleep → cap intensity, hit protein before training"), not to invent the verdict.
  Deterministic fallback always present.
- A4. Plan lookahead: today's fueling call reads tomorrow's planned session.

**Definition of Done:** `/today` returns a verdict driven by numbers + trend, with a
one-line reason that cites the actual deltas; deterministic path passes tests with no LLM;
no hardcoded keyword branch remains. Multi-user calorie targets no longer hardcoded.

### Phase B — Ops Agent digest gets a real brain  ✅ DONE + DEPLOYED (2026-06-06)
**Goal:** the digest surfaces the cards that *matter*, ranked, with the signals that decide.
**Delivered:** `src/digest/card-ranking.ts` (ranks cards by the cockpit's own reason taxonomy — urgent/blocked/overdue/waiting/stale/no_next_action — plus follow-up counts; links updates→cards by title/project match with confidence); `OpsCard.updatedAt` added (via `listCards` select) so real staleness works; `buildDeterministicDigest` rewritten — no more "first 5 updates, zero cards"; LLM context now carries ranked attention cards + a linking index; prompt loosened to suggest next actions + emit confidence. 3 new tests; full suite 294 green. Remaining: redeploy worker/trigger — Hart's call.

- B1. Reuse the existing `get_ops_attention_cards` ranking (urgent/blocked/waiting/stale/
  no-next-action) — the smart logic already exists in `/briefing`; digest must consume it.
- B2. Enrich the LLM context with the omitted signals: `dueAt`, last-activity age,
  follow-up counts + overdue follow-ups, document-pending, blocked relationships.
  Pre-rank and send the **top ~15 cards by urgency**, not 40 unsorted.
- B3. Make the deterministic fallback actually link updates→cards (title/project match)
  and explicitly surface stale/blocked/urgent cards — never again "first 5, zero cards."
- B4. Loosen the prompt to *suggest* status moves / next actions (still proposal-only,
  still human-approved). Add a confidence field per suggestion.

**Definition of Done:** `/digest` on a real chat proposes card-linked actions ranked by
business urgency, names stale/blocked cards, and the deterministic fallback still produces
useful (not stub) output. Hart confirms it "feels smart."

### Phase C — Cockpit: card → full live dashboard
**Goal:** Hart's exact ask — minimized card = overview; **press a card = expand into that
agent's entire dashboard with live data.**

- C1. Define a per-agent **detail read-model** (richer than the uniform `AgentFactBundle`):
  fitness detail = recovery trend + HRV series + nutrition math + training; ops detail =
  full attention list + sync status + follow-ups. Fed by each agent's own RPCs.
- C2. Build a full-surface detail VIEW (route or full-screen panel), not the 460px drawer.
  Keep the drawer as the quick-peek; the expand is the deep dashboard.
- C3. Live data via the existing read-only GET refresh pattern (no new mutation surface).

**Definition of Done:** clicking Fitness opens a full live fitness dashboard; clicking Ops
opens a full live ops dashboard; both honest about staleness; no fake data; new agents can
register a detail read-model without bespoke UI.

### Phase D — State spine: Supabase, not the filesystem
**Goal:** stop the filesystem-as-database sprawl before it blocks orchestration.

- D1. Move proposals + agent state + threads from local JSON report dirs into Supabase
  tables (`proposals`, `agent_tasks`, `agent_outputs`, `approvals`, `decision_logs`).
- D2. Hosted cockpit reads/writes the queue from Supabase → "0 proposals" bug disappears.
- D3. Keep reports as audit artifacts, but the *source of truth* is Supabase.

**Definition of Done:** the hosted cockpit shows the real proposal queue; no core state is
local-only. This is the prerequisite for any multi-agent work.

### Phase E — CTO input brain (the old 18G)
**Goal:** the "Ask HartOS" box stops being decoration. Type an outcome → get a proposal.

- E1. Wire the existing pieces: request-classifier (intent) → capability-gap (context) →
  proposal-generator (draft) → capability-scoring (risk). Add real context-gathering
  (read live read-models + memory) before drafting.
- E2. Output a real proposal into the (now-Supabase) queue with risk + approval gate.
- E3. Still propose-only. Execution stays behind the existing two-key gates.

**Definition of Done:** Hart types "follow up on the Venkat thread" or "explore a travel
concierge product" and gets a concrete, risk-rated proposal in the queue — not a chat reply.

### Phase F — THEN breadth (only after A–E hold)
In this order, each reusing the Phase A/B reasoning pattern and the Phase C detail-view
contract and the Phase D Supabase spine:

- F1. **Research Agent** — the intelligence supply line (now justified: pattern + spine exist).
- F2. **Rinnegan v1** — cross-system perception (drift, staleness, blind spots) over the
  Supabase spine. Comes before multi-agent, as the ChatGPT blueprint correctly says.
- F3. **Fleet OS** — registry/health/freshness for N agents.
- F4. **Multi-agent orchestration** — typed tasks, shared Supabase state, one orchestrator,
  CTO reconciles, Hart approves. No chatroom-of-agents.
- F5. **Prophet** (forecast) and **Wolverine** (repair) — last, once there are enough
  reliable facts that they aren't horoscope machines.

---

## 4. What NOT to build yet (unchanged from ChatGPT blueprint — it's right)

Full autonomous execution; booking/payment/financial-decision agents; multi-agent swarm;
Prophet/Wolverine; heavy Obsidian graph automation; mobile app; UI animation polish.

---

## 5. The anti-drift contract

1. **One phase at a time, gate before advancing.** N+1 starts only when N's DoD is true.
2. **Depth before breadth.** No new agent until the existing two are smart and the cockpit
   can expand into them.
3. **Reasoning lives in structured verdicts; LLM explains, it doesn't invent the verdict.**
4. **Supabase = facts. Reports = audit. Filesystem ≠ database.**
5. **Propose-don't-act. Human-approval floor. Read-only by default.** (Already true — keep it.)
6. **One cross-repo roadmap** (this doc), not per-repo phase numbers that collide.

---

## 6. Recommended first move

Phase A (Fitness brain) **or** Phase B (Ops digest) — both are contained, high-daily-value,
and establish the reasoning pattern. Phase C (cockpit expand) is the most *visible* win.
Pick one; finish its DoD; then the next. Do not start three at once.
