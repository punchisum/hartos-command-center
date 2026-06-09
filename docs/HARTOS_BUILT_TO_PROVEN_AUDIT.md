# HARTOS — Built → Proven Audit (2026-06-10)

CTO planning audit. Verified by 8 independent read-only auditors against the actual repo + the
live-deploy facts from the deploy session. Strict rule applied: **deployed ≠ proven; tested ≠ proven.**
"Proven live" requires evidence the slice ran live with real data/effects.

## The one finding that matters
**Every area is BUILT + TESTED. Every area is NOT_PROVEN.** The system is architecturally complete
and deployed, but **zero slices have executed live with real data.** No gated write has ever fired.
No agent has been born. No memory snapshot has been captured. The deployed Ask path is deterministic
(LLM never called). HartOS is *proven sound, not proven live.* Tomorrow must close that — not build more.

---

## 1. Truth Status

| Area | Built? | Tested? | Proven live? | Evidence | Gap | Next action |
|------|--------|---------|--------------|----------|-----|-------------|
| **L0 — Safety foundation** | BUILT | TESTED | **NOT_PROVEN** | execution-gate.ts (6 fail-closed conditions), doctrine.ts (ACTION_EXECUTION=disabled), audit-tail append-only, strict TLS; gate/adapter/canary tests green (2192 total) | No real gated write has *ever* fired. Canary never run with a real flag + DB. | Fire ONE gated canary (refresh-sync **or** a ClickUp mutation) → confirm audit row appears |
| **L1 — Factory Agent v1** | BUILT | TESTED | **NOT_PROVEN** | coordinator (7-stage), inbox/interrogator/manifest-compiler/build-planner/officiator/repair; factory tests green | **No agent born live.** `cockpit_agents` never written (dryRun gate always on); `CockpitState` carries no factory jobs; fleet reads only `agent-integrations.local.json` (fitness/ops) | Wire factory-job → CockpitState + a go-live persist gate; birth ONE agent end-to-end |
| **L2 — LLM Ask** | BUILT | TESTED | **NOT_PROVEN** | ask-llm.ts orchestrator, llm-gateway, openai-provider, cockpit-ask-host.ts; tests green | **Deployed Worker leaves `ctx.askInfer` undefined → `/api/ask` is deterministic only.** Real LLM never called in the live path | Wire `askInfer` into the deployed Ask surface (Edge/Node host) with key + network flag; verify `usedLlm=true` |
| **L3 — Fleet intel + Awareness + Memory** | BUILT | TESTED | **NOT_PROVEN (BLOCKED)** | strategic-awareness, executive-memory, memory-store/capture, fleet-synthesis, perception, forecast, delta-consumer; ~55 tests green; Strategic Awareness IS surfaced in cockpit | **Memory loop never closes:** `captureSnapshot()` has zero call sites, `HARTOS_MEMORY_CAPTURE` default-OFF, no persister → Executive Memory always `INSUFFICIENT_HISTORY`. Perception/forecast computed but not surfaced in `/api/ask` | Build a Node memory-heartbeat persister (Supabase MemoryStore) + capture on a schedule; thread `ctx.memorySnapshots` live |
| **L4 — Mutation spine + Phase 1 executor** | BUILT | TESTED | **NOT_PROVEN** | dispatcher, T0/T3 adapters, instruction→rehearsal, card-resolver, approved-executor, state-delta; spine-e2e + adapter tests green. NOTE: `.env.local` has `ALLOW_EXEC_CLICKUP_COMMENT=true` (comment flag ARMED); move flag OFF | **No real ClickUp mutation has ever fired.** No `approved_for_execution` proposal exists in the queue; move flag off | Create + approve one proposal → `npm run execute:approved` with the flag → verify card moved + `executed` + delta |
| **Beezulbub** | BUILT | TESTED | **NOT_PROVEN** | capability-report, scout, github-search, extractor, pack-lifecycle, poison-filter; report folds into Build Planner (§19 clamp); tests green | CLI-only; never run against a real GitHub repo; factory-coordinator never invoked in the live cockpit path → report never populated live | **Defer.** (Not on the critical path to live/useful) |
| **Cockpit V2** | BUILT | TESTED | **NOT_PROVEN** | All V2 sections render (hero/awareness/memory/focus/fleet/approvals/health); 9 structure tests; DEPLOYED `dbb4e330`, /health ok, login gate active | Not verified the **login-gated page returns real fitness/ops data**; Executive Memory will be empty (no capture) | Log in → confirm real fleet/awareness data renders; close the memory loop (above) |
| **Research-agent pathway** | **PARTIAL** | PARTIAL | **NOT_PROVEN** | research-planner, research-job (AgentJob/boundary), storage adapters (local-folder + **obsidian** already built, gated), `research` intent → proposal; planner/job tests green | **No ResearchExecutor** — jobs can be planned + proposed, never *run*. No research-findings → CapabilityReport bridge. Flywheel inert | **Defer** to the flywheel track; build the executor first when we get there |

**Net:** 7 of 8 BUILT+TESTED+NOT_PROVEN; research is PARTIAL. The constant is NOT_PROVEN. This is a
*proof* problem, not a *build* problem.

---

## 2. The Real Bottleneck

**Primary bottleneck: LIVE PROOF of the execution floor (L0 + L4).**
Not deployment (done), not cockpit beauty (done), not intelligence depth (done). The single thing
blocking *everything* downstream is that **no gated write has ever executed against real data.** Until
one does, L0 (the gate), L4 (the spine), the audit table, and the StateDelta loop are all theoretical.
Worse, every higher capability (born agents that mutate, Ask that proposes actions, memory that learns
from outcomes) *depends* on this floor being proven. You cannot trust the system to act until it has
acted once, safely, observably. One reversible canary collapses the largest cluster of NOT_PROVENs.

**Secondary bottleneck: the cockpit is deployed but not yet USEFUL DAILY.**
It's live and gorgeous, but (a) we haven't confirmed real fitness/ops data renders behind the login,
and (b) Executive Memory is permanently empty because nothing captures snapshots. A cockpit that shows
real numbers + a filling memory is the difference between "an impressive deploy" and "Hart opens it
every morning." This is the usefulness lever, second only to proving the floor.

Everything else (agent birth, LLM depth, research flywheel, Obsidian) is downstream of these two.

---

## 7. Cockpit V2 End-State Check

- **Is cockpit visibility the main usefulness bottleneck?** *Partly.* The redesign is done and
  Strategic Awareness + Fleet are wired. The real gaps are **data, not design**: unverified live
  read-model rendering + an empty memory section. Do not do more visual work.
- **Intelligence that exists but isn't surfaced well:** Executive Memory (empty — no capture),
  perception/forecast (computed, not surfaced in `/api/ask`).
- **Top screen should show (in order):** Executive Brief hero (Recommended Focus · Top Risk w/
  history · Top Opportunity · Top Approval · System) → Strategic Awareness top items → Today's Focus
  (Do Now / Can Wait) → Fleet cards → Approvals. (All already built — needs *real data behind it*.)
- **Strategic Awareness:** keep as the 4-column risks/opps/drift/blind-spots; it's already grounded.
- **Executive Memory:** stop showing INSUFFICIENT_HISTORY — close the capture loop so patterns/trends/lessons appear.
- **Approvals:** the existing decision cards (why-approve/why-reject) — make them the act surface.
- **Fleet:** the existing six-field cards; verify they carry live fitness/ops signals.
- **Smallest high-ROI slice:** **verify live data renders + wire the memory persister.** Zero new UI.

---

## 8. Live Graduation Checklist

| Step | Status | Note |
|------|--------|------|
| Branch push | **ready (done)** | command-center + 3 sibling repos pushed |
| Deploy | **ready (done)** | Cockpit V2 live `dbb4e330`, /health ok |
| Hosted health | **ready (done)** | `{"ok":true,"mode":"hosted","actionExecution":"disabled"}` |
| Proposal transition route auth | **ready** | wired + smoke-tested fail-closed; not exercised with a real approval |
| Read-model check (live data) | **unknown** | behind login — must verify real fitness/ops data renders |
| Mutation canary | **blocked** | needs: arm `ALLOW_EXEC_CLICKUP_MOVE` (comment flag already armed) + confirm `CLICKUP_API_TOKEN` + one `approved_for_execution` proposal |
| Audit verification | **ready** | after canary: confirm append-only audit row in `cockpit_proposal_audit` |
| Rollback verification | **ready** | after canary: reverse the move (or delete the comment) — confirm reversible |
| Agent birth canary | **blocked** | needs CockpitState factory-job wiring + `cockpit_agents` persist gate (L1) |
| Cockpit registration (born agent) | **blocked** | same wiring as above |
| Final proof report | **blocked** | write after canary + cockpit-data verify land |

---

## 9. Obsidian Decision

**Decision: A — No Obsidian tomorrow.**
- Tomorrow is live-proof + usefulness; Obsidian is a meaning layer that adds zero to proving the floor
  or making the cockpit render real data. Adding it now is patch-addiction.
- *What it would solve that Supabase/Executive Memory doesn't:* long-form narrative/doctrine/decision
  journals — genuinely valuable, but **after** the operational truth layer is proven live.
- **Groundwork already exists** (verified): `src/research/storage/obsidian-storage.ts` is built + gated
  + tested, reusing the local-folder adapter with frontmatter. So when Obsidian's time comes, the
  smallest safe slice is **C — an `ObsidianNoteProposal` contract** (title/folder/tags/body/sources/
  confidence/reason; Hart-approval-gated; local-only write; no hosted/Worker vault access; no secrets;
  proposed-note generation before any vault mutation). Architecture stays: **Supabase=facts ·
  Executive Memory=structured patterns · Strategic Awareness=current signals · Obsidian=meaning.**
- Not tomorrow. Revisit after the floor is proven live and the cockpit is proven useful.

---

*Conclusion: stop building. Prove the floor with one reversible canary, make the cockpit render real
data + a filling memory, and (if budget remains) let HartOS actually reason with an LLM. Everything
else waits for a proven floor.*
