# HartOS Agent Depth Doctrine

> Companion to [HARTOS_BLUEPRINT_V2.md](./HARTOS_BLUEPRINT_V2.md). The blueprint says
> *what to build and in what order*. This doctrine says *what makes an agent deep
> instead of dumb*, grounded in what the live Supabase data actually shows today
> (2026-06-06). Every future agent is held to this.

---

## 0. The one line

**A HartOS agent is not a data-reporting bot. It turns raw signals into a judgement
Hart can act on — it sees trends, not snapshots; it explains, it doesn't echo; it
flags what's wrong before he asks; and it remembers.**

"Depth" is the gap between *"here is your data, formatted nicely"* and *"here is what
it means, what's changing, and what to do."* Today both agents live mostly on the
wrong side of that gap. This doctrine closes it.

---

## 1. The test for "is this intelligent or dumb?"

Apply these five questions to any agent output. Each "no" is a depth defect.

1. **Judgement, not echo** — does it state a verdict/recommendation, or just reformat numbers?
2. **Trajectory, not snapshot** — does it know what's *changing* (trend, streak, drift), or only today's value?
3. **Integration, not silos** — does it weave the signals together (recovery × training × nutrition; card × dependency × value), or list them separately?
4. **Proactive, not on-demand** — does it surface what matters before Hart asks, or only when polled?
5. **Memory, not amnesia** — does it remember past state, advice, and what Hart acted on, or start blank every time?

A deep agent answers **yes** to all five. The blueprint's load-bearing rule still
holds underneath: *the reasoning lives in structured logic; the LLM explains it, it
never invents it.*

---

## 2. The Agent Intelligence Stack

Every agent climbs the same six layers. You cannot skip a layer — trend detection on
fragmented data is garbage; synthesis without derived signals is hand-waving. Depth =
how high the agent has climbed.

| Layer | What it does | "Dumb" failure | "Deep" target |
|---|---|---|---|
| **L1 Data integrity** | One clean, deduplicated, trustworthy record per entity/day | fragmented/duplicate rows, null fields | canonical, complete, fresh |
| **L2 Derived signals** | Compute the judgements the raw data lacks (scores, loads, states) | the verdict field is null; computed at read-time only, never stored | persisted, queryable, historical |
| **L3 Trend / pattern** | Detect multi-period change (streaks, drift, monotony, aging) | only "today's value" | "down 10 days", "3rd stale week" |
| **L4 Synthesis** | One coherent call that integrates all signals | siloed sections | "given X+Y+Z, do W" |
| **L5 Proactivity** | Push when a pattern crosses a threshold | waits to be polled | morning brief / risk alert |
| **L6 Memory / learning** | Remember state, advice given, what was acted on; adapt | amnesiac each run | "you ignored this 3×", learns Hart's patterns |

---

## 3. Grounded current state (live Supabase, 2026-06-06)

### Fitness agent — a reporting layer, blind above L2
Evidence from `fitness_daily_state` (last 14 days):
- **`recovery_status` is NULL on all 14 days.** The agent never persists a recovery
  verdict — the column exists and is never written. (This is why the original keyword
  coach was always generic: it matched on a string that's always empty.)
- **`training_load` is 0.00 on 13/14 days.** Training load is effectively not computed.
- **`nutrition_status` is NULL on all 14 days.**
- **Fragmented rows:** 2026-06-01 has **4 separate rows** — one with HRV 27.79 + sleep +
  steps, three with only partial calories. A day's truth is split; the read-model picks
  one row and loses the rest. **This is an L1 integrity defect that corrupts everything above it.**
- **A real, invisible pattern:** HRV ran 50→33→22→33→28→33→36→38 over the window — a
  sustained ~10-day suppression well under the 5/28 value of 50. The agent reports today's
  number and is **completely blind to the trend** (L3 absent).
- Recent days (06-05, 06-06) have **null HRV/RHR** — wearable sync is spotty, and nothing flags it.

Verdict: Phase A gave it an L4 *moment* (a good single-day call), but it sits on broken
L1, empty L2, and no L3/L5/L6. It feels shallow because it is.

### Ops agent — smarter surface, hollow underneath
Evidence from `digest_runs` + `clickup_cards`:
- **`cards_with_risk = 0` of 9 active cards.** No card carries a `risk_level`, so the
  ranking's "urgent = high/critical risk" branch never fires — only status/overdue do.
  Risk-based prioritisation is dead on arrival.
- **`provider_used = 0` on all 14 runs, `model = null`** — yet the live proposals are
  clearly LLM-written. The model works; the **provenance logging is wrong** (checks
  `args.env` not `process.env`). Observability is lying about whether the brain ran.
- The digest is **stateless** (L6 absent): no memory of what it proposed before, no
  tracking of what Hart applied/rejected, so it can re-propose dead ideas.
- It ranks by age/status but doesn't know **deal value or dependencies** (L4 shallow) —
  a 3-day-overdue $X deal and a 12-day-overdue trivial card are ranked only by days.
- **A live correctness bug found in this pass (now fixed):** `safeText` was redacting
  the 36-char card UUID to `[redacted]`, so apply POSTed a non-UUID into a uuid column
  and crashed. Root-caused via the `agent_logs` 22P02 error and patched (`safeId`).

Verdict: Phase B gave it a strong L3/L4 surface (overdue/stale ranking, card linking),
but L1 (risk unpopulated), L2 provenance, and L6 memory are missing.

---

## 4. Per-agent depth roadmap

Each item names the stack layer it raises. Ordered so foundations come first.

### Fitness
- **FD-1 (L1) Consolidate the daily state.** One canonical row per `(user, date)` — the
  read RPCs must aggregate all same-day rows (max HRV/sleep/steps, sum nutrition), not
  pick one. Fixes the fragmentation that corrupts every downstream read.
- **FD-2 (L2) Persist the recovery verdict + training load.** Write the Phase A recovery
  score/band/readiness and a real `training_load` into `fitness_daily_state` daily, so
  they're historical and queryable — not recomputed-and-forgotten at read time.
- **FD-3 (L3) Trend engine.** Detect sustained HRV suppression, sleep-debt accumulation,
  protein consistency, and training monotony over 7/14/28 days. Output "what's changing",
  not "today's value".
- **FD-4 (L5) Proactive morning brief.** Finish the in-flight `morning-briefing.ts` to push
  the depth verdict + the day's one trend insight every morning — don't wait for `/today`.
- **FD-5 (L6 / L1) Sync-health watchdog.** Flag when HRV/sleep haven't synced in N hours
  (06-05/06-06 were silently null) and remember gaps.

### Ops
- **OD-1 (L1) Populate `risk_level`.** Infer/import risk per card so risk-based ranking
  actually fires (0/9 today). Without it the digest is half-blind.
- **OD-2 (L2) Fix provider provenance.** Log the real model/provider used; surface
  degraded runs honestly so "is the brain on?" is answerable.
- **OD-3 (L6) Digest memory.** Track proposals across runs + what Hart applied/rejected;
  suppress repeats; escalate ignored items ("flagged 3 digests running").
- **OD-4 (L4) Value + dependency awareness.** Rank by business impact, not just age — add
  deal-value and blocks/blocked-by signals so ranking reflects what actually matters.
- **OD-5 (L5) Stale-deal early warning.** Catch a deal going cold *before* it's 12 days
  overdue, by trending card activity.

---

## 5. Doctrine rules (how Hart wants it)

These extend — not replace — the blueprint v2 anti-drift contract.

1. **Climb the stack in order. No skipping.** Don't build L3 trends on L1-broken data.
   Foundation defects (null verdicts, fragmented rows, dead risk fields) come first.
2. **Persist judgements, don't just compute-and-throw-away.** A verdict that isn't stored
   can't be trended, audited, or learned from. L2 outputs are first-class data.
3. **Reasoning is structured; the LLM only explains.** Unchanged and absolute. The LLM
   formats and phrases; it never decides the verdict or invents a number.
4. **Honesty over polish.** Null is null — say "not synced" (and flag it), never fabricate.
   The fitness brain already does this; keep it everywhere.
5. **Observability must not lie.** If the model ran, log that it ran. Mis-provenance is a bug.
6. **Propose-don't-act, human-approval floor.** Deeper agents are *more* capable, so the
   approval gate matters more, not less. New depth ships behind it.
7. **Proposals before builds for anything non-trivial.** Surface the plan, get approval,
   then implement — this doctrine's §4 backlog is the standing menu.

---

## 6. How this composes with the blueprint

The blueprint's Phase C–F (cockpit expand, Supabase spine, CTO brain, then breadth) are
unchanged. This doctrine is the **quality bar inside every phase**: each agent that
exists or gets built must climb the L1→L6 stack, and "done" for an agent means it passes
the five-question test in §1 — not merely that it renders without error.

**Near-term sequencing recommendation:** fitness FD-1/FD-2 and ops OD-1/OD-2 are the
cheapest, highest-leverage (they fix foundations and unlock everything above). Do those
before the bigger L3/L4/L6 work — and before adding any *new* agent, per blueprint §2
(depth before breadth).
