# HartOS — Vision

> The north-star document. *What* HartOS is and *why*, the layers it's made of, the doctrine
> that binds every layer, the order we build in, how we know a layer is real, where it stands today,
> and how the system feels in use. Sequencing lives in [HARTOS_BLUEPRINT_V2.md](./HARTOS_BLUEPRINT_V2.md);
> the constitution lives in
> [HARTOS_SHARED_DOCTRINE.md](./HARTOS_SHARED_DOCTRINE.md). Where they conflict, the doctrine wins.

## 0. Prime directive

HartOS is the command operating system for Hart's business, fitness, research, and personal
execution: **Hart states an outcome → HartOS checks live context + memory, reasons from facts,
decomposes, proposes, asks for approval where required, executes only through governed paths,
reports back, and remembers.**

Agents do not exist to be clever. They exist to increase Hart's clarity, leverage, and execution
quality. The standard is never "impressive" — it is "does this improve Hart's execution?"

---

## 1. System layers

**Command HartOS (Cockpit)** — the control surface. Where Hart sees the whole fleet and issues
intent. Hosted, auth-gated, honest about staleness. The interface between Hart's will and the body.

**CTO / Orchestrator** — the architecture brain. Decides what to build next, reconciles, prevents
drift, guides Factory and Cockpit evolution. Prophet (foresight) rides inside it as a skill.

**Agent Factory** — the regeneration system. Creates new agents: plan → scaffold → PR → data layer
→ runtime deploy, every step gated and human-approved. Live-proven end to end.

**Beezulbub** — capability digestion. Scouts external repos, rejects poison, turns useful patterns
into HartOS capability packs. Acquisition, not authority.

**Domain agents** — the specialist workers that carry Hart forward. Fitness (recovery/training/
nutrition) and Ops (business execution) are live; Research, Travel, Life Coach, Business Co-Pilot,
Tax/Finance follow. Each must earn its place by producing a useful output Hart can act on.

**Fleet Intelligence (Fleet Brain)** — the deterministic, rule-first synthesizer. Folds live
AgentSignals + the proposal queue + StateDeltaSignals into a single prioritized briefing: what
matters · why (evidence-backed) · owner agent · proposed action · risk if ignored · confidence/
freshness · exact blocker. No LLM in the verdict; confidence is clamped to the weakest input.

**Wolverine Layer** — the immune system of HartOS. Wolverine continuously audits HartOS itself and
the full agent fleet for broken wiring, stale data, unsafe flags, missing tests, weak outputs,
doctrine drift, unmerged branches, stale memory, proposal bugs, failed deployments, stale
read-models, suspicious confidence, duplicated capabilities, and improvement opportunities.

Wolverine's job is to reduce the manual maintenance burden of HartOS.

It does not silently mutate systems.

It diagnoses automatically, ranks issues by severity, generates FixProposals, and routes them to
Hart for approval. After a fix is approved and executed, Wolverine verifies whether the repair
actually worked.

Wolverine should answer:

* What is broken?
* What is stale?
* What is unsafe?
* What is underperforming?
* What is drifting from doctrine?
* What is duplicated?
* What is missing?
* What should be improved?
* What should Hart approve next?

Wolverine is not the builder. It is the internal inspector, immune system, and repair proposer.
Factory / Codex / build agents may implement approved fixes, but Wolverine **detects, ranks,
proposes, and verifies**.

*Without Wolverine, every new agent increases maintenance burden. With Wolverine, every new agent
becomes monitorable, governable, improvable, and safer to operate.* This is why Wolverine is one of
the highest-leverage next pieces after the live floor and LLM Ask — a **foundational** layer, not an
optional one.

**Perception & foresight (next horizon)** — Rinnegan (cross-system perception: drift, patterns,
blind spots) and Prophet (forecast + scenarios, self-scored). Built last, on trustworthy fleet data,
so they aren't horoscope machines. Obsidian is the meaning/memory layer, downstream of truth.

---

## 2. Doctrine (binding on every layer)

The five clauses that override the rest (full constitution in HARTOS_SHARED_DOCTRINE.md):

1. **Supabase = facts, Obsidian = meaning, LLM = reasoning over curated context — never raw authority.**
2. **Deterministic verdicts before LLM explanation.** Rules compute the verdict; the LLM explains it; the LLM never invents or overrides it.
3. **Propose, do not act.** Default is proposal-only. The human-approval floor is permanent.
4. **Honest staleness always.** Every output carries freshness + confidence + source. Unknown is not failure; fake confidence is failure. A summary is only as confident as its weakest input.
5. **Depth before breadth.** Existing agents must become useful before new agents multiply. Building capacity faster than intelligence is drift.

**+ Wolverine clause — Diagnosis can be automatic; repair must be approval-gated.** Wolverine may
inspect, detect, score, and propose fixes automatically. But any repair, code change, system
mutation, deployment, or agent modification must go through proposal → approval → execution gate →
audit → rollback path. Automatic eyes; gated hands.

---

## 3. Sequencing (what's next)

1. **Lock the proven floor** — commit/push the live graduation proof; keep execution flags and
   deploy gates **disarmed**; continue the daily memory heartbeat until pattern intelligence is real.
2. **Close the intelligence core** — wire LLM Ask to full HartOS context so the cockpit can speak
   like a deeply briefed operator.
3. **Build Wolverine v1** — read-only auditor + FixProposal generator. This comes **before** broad
   new domains, because every new agent increases maintenance load unless Wolverine exists.
4. **Light up the knowledge loop** — ResearchExecutor → ResearchBriefs and Beezulbub → CapabilityReports.
5. **Close the self-building flywheel** — Factory → Officiation → Fleet registration.
6. **Add new life domains** — Travel Planner, Life Coach, Business Co-Pilot, Obsidian note proposals.

---

## 4. Success criteria

A layer is "real" only when it produces a useful output Hart can act on, under the honesty contract —
not when it scaffolds. Shipped means deployed and verified, never merely committed.

**The one hard test for HartOS:** every morning Hart opens the cockpit *first*, and trusts it enough to
act without re-checking the source apps. If that holds — and a steady stream of approvals flows through
the gate each week — HartOS is working. If Hart stops opening it, no amount of architecture matters.

**Wolverine** specifically: HartOS becomes meaningfully safer and more scalable when Wolverine can run
a regular system audit and produce a ranked repair queue. **Wolverine v1 succeeds if it can produce:**

* system verdict: **GREEN / AMBER / RED**
* top 5 risks
* top 5 fixes
* top 5 improvement opportunities
* stale agents / read-models
* armed flags or unsafe gates
* failed or missing tests
* known bugs
* missing proof reports
* doctrine drift
* concrete **FixProposals** with severity, evidence, recommended fix, blast radius, rollback path, and approval requirement

**The hard test for Wolverine:** Hart should no longer need to manually remember what is broken, stale,
unsafe, or worth improving. **Wolverine should surface it before Hart has to go looking.**

---

## 5. Status — today vs. endgame

This document describes the endgame. To honor the honesty clause, here is where it actually stands.

**Proven live:** the cockpit, the proposal spine, and the execution gate (capability tokens, allowlist,
kill-switch, audit). The full loop — propose → approve → execute → audit → remember — has fired on real
ClickUp cards. Real specialists: Fitness, Ops, Factory, Beezulbub. Executive memory persists durably in
Supabase behind a deployed Worker. LLM Ask now reasons over live HartOS context — the "deeply-briefed
operator" cockpit — shipped 2026-06-10, pending Hart's login verify.

**Built, not yet fully wired/live:** Factory v1 (Inbox → Interrogator → Manifest Compiler), the research
job, officiation core, Fleet Brain.

**Still ahead:** Wolverine (the immune system) and the new domains — Travel, Life Coach, Business Co-Pilot.
The intelligence core is now wired; what remains is self-maintenance and breadth.

**Honest read:** the hardest half — the safe-execution spine — is done. What remains is mostly adding
intelligence and domains on rails already laid. Breadth waits for depth.

---

## 6. A day in the life

Hart wakes, opens the cockpit, reads a 30-second briefing — what's on fire, what needs his call, one
opportunity closing. Over coffee he says "I want to go Korea for a week." By lunch there's a route-optimized
7-day itinerary, restaurant options, and booking cards waiting. He rejects two, approves the rest; HartOS
books them, logs it, remembers his taste for next time. Meanwhile Ops flags a client follow-up going stale —
one tap approves the comment. That evening an idea hits; he dumps it in, and instead of cheerleading HartOS
says *"validate first; this is a distribution problem, not a product."* None of it required Hart to *manage*
anything. He just decided.

---

## 7. Worked examples

**Travel — "Korea, 7 days, find popular spots from TikTok/IG, restaurants, full itinerary, prep bookings
for approval."** HartOS clarifies dates/budget/style → researches current popular places and social trends
where available → finds restaurants, cafes, nightlife, experiences → builds a route-optimized itinerary →
creates booking candidates as approval cards → stores the trip dossier in Obsidian → remembers preferences.
Missing capability (social scraping, booking automation)? It says so and offers a capability request for
Beezulbub + Factory — it never fakes it, and never auto-books.

**Business idea — "I have a business idea."** No cheerleading; a ruthless co-founder. Who's the buyer? What
painful problem? Who pays? Why now? What's the wedge and unfair advantage? Fastest validation test? What
should *not* be built yet? Distribution, service, infra, or software? What assumption could kill it? Then it
produces a BusinessIdeaBrief, AssumptionMap, ValidationPlan, MarketResearchBrief, PRD, BuildPlan, approval
cards, and an Obsidian dossier — willing to say "don't build yet," "this is distribution, not product," or
"strong enough for MVP." If it passes: Research investigates, Beezulbub scouts, Factory specs, Build/Codex
builds the MVP, Ops creates rollout tasks. A co-pilot, not an app generator.

**Life Coach — "Create a life coach that governs mindset."** Read as agent creation. It doesn't clone a
famous coach — it synthesizes public high-performance coaching, emotional regulation, decision quality, and
Hart's own doctrine into a HartOS-native advisor for reflection, blind-spot detection, impulse management,
and daily/weekly review loops. Hard boundaries: not a therapist, not medical, not manipulative, not blindly
motivational; recommends professional support when appropriate. Output: AgentManifest, tone contract,
check-in formats, memory schema, cockpit card, boundaries — and an approval proposal before activation. It
joins the fleet only after officiation.
