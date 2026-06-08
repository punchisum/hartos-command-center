# HARTOS — 3 LEVELS UP + MUTATION MAP (master build plan)

**Status:** approved aggressive scope, 2026-06-08. **Supersedes** `HARTOS_PLAN_3_LEVELS_UP.md`.
**Extends** `HARTOS_IMPLEMENTATION_PLAN_TO_80.md` (Phases 0–3 deployed; Phase 3 canary fired+proven)
and `HARTOS_BLUEPRINT_V2.md`. Doctrine source of truth: `DOCTRINE.md` + `HARTOS_SHARED_DOCTRINE.md`.

This is the real map, not a roadmap. It is written to be executed.

---

## 0. What HartOS is (one sentence)
HartOS is one loop with a hard floor: **command → reason → propose → approve → mutate → audit →
refresh state → learn the new state** — where the cockpit is a **read/control plane only** and every
mutation runs **off-Worker through a typed, gated, audited adapter**.

The cockpit is no longer "a dashboard," "an agent factory," or "Ask HartOS." It is the **control
plane for a fleet that proposes work and, on Hart's approval, mutates internal and external state and
learns the result.**

```
Hart speaks or clicks
  ↓
HartOS reads live context        (read models, anon, Worker)
  ↓
HartOS reasons                   (LLM behind a gate, honest fallback)
  ↓
HartOS proposes TYPED actions    (TypedActionProposal, executable:false)
  ↓
Hart reviews DRY-RUN             (before-state + predicted after-state)
  ↓
Hart approves                    (deliberate click — never voice, never LLM)
  ↓
HartOS executes via gated adapter (Node host / capability-token Edge Function — never the Worker)
  ↓
HartOS writes audit              (append-only, before + after)
  ↓
HartOS refreshes read state      (the new truth)
  ↓
Fleet intelligence updates       (the loop closes)
```

---

## 1. Non-negotiable doctrine (the floor — law, not preference)
Every line below is enforced in code or the plan is wrong:

- **No approval = no mutation.**
- **No dry-run = no mutation.**
- **No audit = no mutation.** (audit-before AND audit-after)
- **No clear target = refusal.** (vague intent is rejected, not guessed)
- **No secret in prompts.** (redaction before any LLM call)
- **No service-role key in the Worker.** Worker is read/control-plane only.
- **Mutation only through typed adapters.** No freeform/natural-language execution.
- **Voice can ask; voice cannot approve or execute.**
- **LLM can reason and propose; LLM cannot execute or approve.**
- **Every external mutation is read-before-write**, with **target confirmation**, an **idempotency
  key**, **audit-before + audit-after**, and a **rollback/correction note**.
- **Every live deploy / migration / irreversible external action needs an explicit final gate**
  unless Hart approved that exact action in-session.

These are already encoded for the internal path: `src/doctrine/doctrine.ts` (9 clauses + CI
conformance test) and `src/doctrine/execution-gate.ts` (fail-closed precondition). This plan extends
the SAME gate to every new adapter. No adapter gets its own bespoke gate.

---

## 2. Architecture stress-test (ruthless: what's real, thin, or redundant)
Read this before building anything. It changes the sequence.

1. **The mutation spine is NOT greenfield — it is the generalization of the proven refresh-sync
   path.** `execution-adapter.ts` (`runExecutionAdapter`: audit-attempt → gate → execute → audit),
   `adapters/refresh-sync.ts`, `run-refresh-sync.ts/-db.ts` already ARE the mutation spine for one
   action. The work is **promoting `ExecutionAdapter` to a typed-action contract** + adding adapters +
   a UI. Do not rebuild the engine. The canary already proved it end-to-end in prod.

2. **Mutation Tiers 0–1 mostly already exist and are deployed — do not rebuild them.** The Edge
   Function `persist-cockpit-proposal` already does conditional `approve`/`reject`/`refresh_sync` with
   append-only audit; `proposal-queue.ts` owns the full two-key lifecycle
   (`draft→pending_approval→simulated_approved→approved_for_execution→executing→executed`). Tier 0/1 is
   **surface them in a Mutation Center UI + thin executor wrappers**, not new logic.

3. **External mutation (ClickUp) cannot run in the Worker.** Worker holds no service/external keys.
   ClickUp adapters run on the **Node host** (like the canary's DB executor) OR behind a
   **capability-token Edge Function** holding the ClickUp token — exactly the split the canary proved.
   Encode this; do not let a ClickUp token near the Worker.

4. **LLM inference should NOT put `OPENAI_API_KEY` in the Worker.** Keep the Worker key-free: run
   reasoning behind a **capability-token Edge Function** (or Node), consistent with the write path.
   The gateway exists (`LLM_GATEWAY.md`, `llm-*` modules: provider-select, redaction, output-validate,
   usage-log). Wiring + placement is the work, not the gateway.

5. **Two proposal stores = split-brain risk.** There is a filesystem queue (`proposal-queue.ts`, used
   by agent-creation) AND the Supabase `cockpit_proposals` spine (Worker reads anon, Node/Edge writes).
   **The mutation spine standardizes on the Supabase spine** as the cockpit's source of truth. Anti-drift
   rule below.

6. **Reconcile with the existing action contract.** `COMMAND_CENTER_ACTION_CONTRACT.md` +
   `src/command-center/action-contract.ts` already define an action contract. The TypedActionProposal
   (§5) must **extend/align with it**, not fork a parallel shape.

7. **Shared doctrine is ~80% done — verify + enforce, don't re-invent.** `HARTOS_SHARED_DOCTRINE.md`
   exists and the Factory already injects it into generated agents (commit 410210e). Pillar #9 is a
   **conformance gate**, not a write-from-scratch.

8. **A "born" agent is a read-only monitor. It proposes; it does not get its own mutation adapters on
   day one.** Keep that boundary crisp or "0→100" balloons into "every new agent can touch prod."

**Net effect on sequence:** the cockpit **mutation spine (Level 4) is the new center of gravity and
the highest-leverage, lowest-risk work** (it generalizes proven code). Agent-creation 0→100 (Level 1)
is the **biggest single lift** because it needs live, gated, partly-irreversible provisioning. They are
not the same size; the original plan implied they were. Re-sequenced below.

---

## 3. The levels (collapsed + re-sequenced)

### LEVEL 0 — Safety foundation (mostly done; finish the hardening FIRST)
**Done:** deployed cockpit, doctrine-as-code, approval spine, proposal lifecycle, audit table,
fail-closed gate, refresh-sync canary fired+proven.
**Remaining hardening (do before broadening mutation):**
- Strict TLS for the DB executor (supply Supabase CA; kill the `relaxed` fallback warning).
- **Server-side live proposal-status verification before execution** (today the runner asserts
  `approved_for_execution`; the gate must re-read the live row). *This is the single most important
  safety gap before more adapters.*
- Global kill-switch verification + per-action allowlist verification (tests that prove both bite).
- Better audit-row confirmation tooling (a read-only `audit:tail` to confirm any execution).
- Branch/main consolidation strategy (nothing is on `main`; decide merge vs keep-feature-branches).

> Files: `run-refresh-sync-db.ts`, `doctrine/execution-gate.ts`, new `scripts/audit-tail.ts`.
> Tests: gate denies on stale/expired/mismatched live status; kill-switch + allowlist unit tests.
> Deploy: none (Node-side) except CA config. Gates: read-only. Rollback: n/a.
> Verify: `npm run canary:refresh-sync` shows `tls: strict`; a tampered status is refused.
> Fails-if: the gate ever allows on an asserted-but-not-live status.

### LEVEL 1 — Agent creation 0→100
**Goal:** a natural-language spec → a **deployed, live, officiated read-only** agent that reads real
data and emits a proposal.
**Flow:** Hart describes → spec resolver → factory scaffold → provisioning plan → **gated** deploy →
agent contract emitted → appears in cockpit → reads real data → emits a proposal.
**Build:** spec resolver (exists: `resolve-agent-spec.ts`) · generated agent-contract + agent-signal +
read-model-config seams (backport from command-center into factory `templates/runtime/src`) ·
`cockpit_agents` registry (anon-readable, Node-writes) · created-agent contract loader in the Worker ·
generic "other" detail page (live) · generated officiation · **one real born agent end-to-end**.

> Files (cmd-center): `cloudflare-cockpit-worker.ts`, `cloudflare-cockpit-page.ts`,
> `cloudflare-live-read-models.ts`, `agents/officiation.ts`, `agents/agent-contract.ts`,
> new `cockpit_agents` table + Edge read. (factory): `templates/runtime/src/{read-models,agents}`,
> `archetype-monitoring.ts`, `create-agent-project.ts`, `scripts/agent-runtime-provision.ts`.
> Tests: contract-loader unit; generic read-model summary→signal; factory officiation backport tests.
> Deploy/migration: `cockpit_agents` table migration; Worker redeploy. **Gates:** provisioning +
> deploy are Hart-fired (cost/irreversible). Rollback: drop the agent's registry row; un-deploy.
> Verify: scaffold the Invoices monitor → it renders a live card + `/agent/other/ui` + one proposal.
> Fails-if: a created agent needs hand-edited TS in command-center to appear.

**Honest limit:** "100" runs the pipeline to the end, but the irreversible/outward steps stay gated.
Born agents are **read-only monitors** — no mutation adapters.

### LEVEL 2 — HartOS talks back
**2A — LLM Ask HartOS.** Wire the gateway into the Ask path: provider selection, prompt **redaction**,
output validation, usage logging, **rule-based fallback** when LLM off, **risk-rated answer that cites
freshness/gaps**, can propose but **cannot execute**. Run inference behind a capability-token Edge
Function / Node (keep the Worker key-free).
> Files: Ask path in `cloudflare-cockpit-worker.ts`, `scripts/cockpit-ask.ts`, `LLM_GATEWAY.md` modules.
> Tests: redaction strips secrets; fallback path; output-validator rejects malformed; usage logged.
> Deploy: Edge Function (LLM relay) + token. Gates: LLM network behind a flag. Rollback: flip flag off
> → rule-based. Verify: ask a question with the key unset → honest "rule-based mode"; set → reasoned.
> Fails-if: any secret appears in a prompt, or the LLM answer can trigger execution.

**2B — Voice seed.** Cockpit mic button → speech-to-text → Ask HartOS → spoken answer; browser-STT
privacy caveat shown; **voice cannot approve, voice cannot execute.**
> Files: `cloudflare-cockpit-page.ts` (Web Speech API JS). Tests: n/a (UI) + a guard test that the
> voice path hits only the read/Ask route. Deploy: Worker redeploy. Rollback: hide the button.
> Verify: speak a question → spoken reasoned answer; no approve/execute control is voice-reachable.
> Fails-if: any mutation route is reachable from the voice path.

### LEVEL 3 — Fleet intelligence
**Goal:** a fleet-level chief of staff, not a wall of cards.
**Build:** fleet synthesizer brain (AgentSignals + proposals + audit + freshness → one briefing);
typed-task spine (**unified with the mutation spine — same TypedAction contract**); task routing by
capability; capability-gap detection; **inaction forecast** (risk if ignored); Fleet Intelligence panel;
rule-first, LLM-enhanced only behind the gate.
**Required output per item:** what matters · why · owner agent · proposed action · risk if ignored ·
confidence/freshness · exact blocker.
> Files: new `src/intelligence/fleet-synthesizer.ts`, `cloudflare-cockpit-page.ts` panel,
> reuse `read-models/agent-signal.ts`, the proposal spine, the audit table.
> Tests: synthesizer carries freshness/confidence forward (no laundering); ordering is deterministic;
> degraded inputs surface, never silently drop. Deploy: Worker redeploy. Rollback: hide the panel.
> Verify: cockpit shows true priority order across agents derived from live signals.
> Fails-if: the briefing inflates confidence above any input's confidence.

### LEVEL 4 — Cockpit mutation spine (the new first-class pillar)
**Goal:** Hart can mutate from the cockpit safely — internal first, external second, always typed +
gated + audited. This is §4–§7 below.

---

## 4. Mutation tiers (build strictly in order)
- **Tier 0 — internal HartOS cleanup:** reject all draft proposals · expire duplicate proposals ·
  archive rejected proposals · mark proposal reviewed · refresh sync · clear stale internal tasks.
- **Tier 1 — proposal lifecycle:** approve · reject · approve_for_execution · expire · dry-run ·
  execute approved internal cleanup. *(Most of this is already shipped in the Edge Function — wrap +
  surface, don't rebuild.)*
- **Tier 2 — ops mirror (still internal):** mark ops item reviewed · resurface waiting card · create
  internal follow-up · tag ops item · mark stale issue handled. *(Writes to HartOS's own mirror, not
  ClickUp.)*
- **Tier 3 — ClickUp (external, last):** **start with only `add ClickUp comment`, then `move card
  status`.** No delete. No bulk. Comment first, move second.

---

## 5. The typed mutation contract (`TypedActionProposal`) + state machine
One contract, aligned with `COMMAND_CENTER_ACTION_CONTRACT.md`. Every mutation — internal or external —
is an instance of it. **No vague mutation. No freeform execution.**

State machine (every action, no exceptions):
```
Intent → TypedActionProposal → DryRunPreview → Hart approval → ExecutionGate
       → Adapter execution → Audit row → Read-state refresh → Cockpit result
```

Required fields (a mutation missing any field is refused at the gate):
`actionType` · `domain` · `targetId` · `targetName` · `beforeState` · `afterState` (predicted in
dry-run / actual after) · `riskLevel` · `reason` · `dryRunResult` · `approvalStatus` · `executionFlag`
· `idempotencyKey` · `auditId` · `rollbackOrCorrectionNote`.

Adapter interface extends the existing `ExecutionAdapter`: `dryRun(deps)` (read-before-write, predict
after-state, no writes) and `execute(deps)` (idempotent, reversible-or-correctable, target-confirmed).
The gate (`checkExecutionPrecondition`) is unchanged and shared by all adapters.

---

## 6. The Mutation Center (cockpit UI spec)
A first-class cockpit surface. It shows:
pending executable actions · dry-run previews · risk · target (id + name) · required approval ·
**Execute Once** button · audit result · refused actions (with denial reasons) · rollback/correction note.

**Vague mutation is rejected by construction.**
- ❌ "clean ops" · "handle cards" · "fix proposals"
- ✅ "reject 8 draft fitness proposals" · "add comment to ClickUp card ABC" · "move card XYZ from
  Waiting → In Progress"

Every button maps to exactly one `TypedActionProposal` with a confirmed target. No multi-target
"apply to all" in v1.

---

## 7. Safe mutation adapters (the actual new code)
- **Internal (Tier 0/1):** `reject-drafts`, `archive-rejected` (build on the refresh-sync framework;
  HartOS's own `cockpit_proposals` only; reversible; idempotent). Each: own allowlist flag, dry-run,
  adversarial tests.
- **Ops mirror (Tier 2):** `resurface-waiting`, `mark-reviewed`, `create-internal-followup` (HartOS
  mirror tables only).
- **External (Tier 3, last):** `clickup-comment` then `clickup-move-status`. **Read-before-write**
  (fetch the card, confirm `targetName` matches `targetId`), idempotency key (no double-post),
  audit-before + audit-after, rollback note (a comment can be edited/deleted by Hart; a move records
  the prior status for one-click correction). Runs Node/Edge with the ClickUp token — **never the
  Worker.**

> Per-adapter verification (template): Files: `src/execution/adapters/<name>.ts` + a runner +
> `tests/<name>.test.ts`. Tests: dry-run no-writes; gate refuses unarmed; idempotent re-run; target
> mismatch → refusal. Deploy: Edge Function op or Node runner; ClickUp token as a secret (Hart-set).
> Gates: per-action allowlist flag default OFF + kill-switch. Rollback: documented correction action.
> Verify: dry-run shows real before-state from ClickUp; armed run posts once; re-run idempotent.
> Fails-if: it writes without a confirmed target, double-posts, or runs from the Worker.

---

## 8. Shared doctrine for every agent (verify + enforce — ~80% exists)
`HARTOS_SHARED_DOCTRINE.md` exists; the Factory injects it (410210e). The base doctrine every agent
inherits: propose-before-acting · honest uncertainty · freshness visible · source visible · no secret
exposure · read-before-write · typed actions only · approval floor · audit trail · idempotency ·
fail-closed · no confidence laundering · no cross-agent hidden mutation.

**Build = a conformance gate, not prose:** a doctrine-conformance test (like
`doctrine-conformance.test.ts`) that every generated agent must pass; domain doctrine may ADD but
never WEAKEN the base. The Factory generates agents with this doctrine + the conformance test by
default.

---

## 9. Explicit exclusions (do NOT build — refuse if asked)
banking / money movement · Apple Health writes · Telegram-send as an execution adapter · Google Drive
mutation · arbitrary natural-language execution · auto-merge · auto-deploy without gate · voice
approval · broad autonomy · delete actions · bulk external mutation.

---

## 10. Aggressive implementation sequence (honest re-budget)
**Ruthless truth:** the ChatGPT Day-1 list (pre-flight + mutation contract + internal adapters +
Mutation Center + agent-creation 0→100 + officiation) is **~13–14h, not one day.** Agent-creation
0→100 alone is a day. So the sequence below targets **MVP vertical slices (one real instance of each),
not complete general systems**, and is honest that the *complete* version is ~3 focused days.

**DAY 1 — internal mutation, end to end (highest leverage, lowest risk):**
1. Level-0 hardening (server-side status check + strict TLS) — *prerequisite.*
2. `TypedActionProposal` contract + state machine (generalize `ExecutionAdapter`; align with the
   existing action contract).
3. Two internal mutation adapters (`reject-drafts`, `archive-rejected`).
4. Mutation Center UI (pending · dry-run · risk · Execute Once · audit · refused).
5. Start the agent-creation 0→100 spine (spec→scaffold→registry; defer live provisioning to Day 3).
**Day-1 target:** HartOS cleans its own proposal queue from the cockpit, safely, fully audited.

**DAY 2 — reason, talk, see, and touch ClickUp:**
1. `clickup-comment` adapter (read-before-write, idempotent, audited).
2. `clickup-move-status` adapter (records prior status for correction).
3. LLM Ask HartOS (2A).
4. Voice seed (2B).
5. Fleet synthesizer + Fleet Intelligence panel (Level 3, rule-first).
**Day-2 target:** HartOS reasons better, shows fleet priority, mutates ClickUp safely (comment+move),
cleans internal state, all gated.

**DAY 3 (the honest addition) — birth a real agent:** finish agent-creation 0→100 (gated live
provisioning + deploy + officiation) → **one real born read-only agent, live.**

**Minimum viable aggressive version (the bar):** 1 born read-only agent · 2 internal mutation
adapters · 1 ClickUp comment adapter · 1 ClickUp move adapter · 1 LLM Ask path · 1 Fleet Intelligence
panel · 1 Mutation Center.

---

## 11. Definition of Done
- A spec produces **one real, live, officiated read-only agent** reading real data + emitting a proposal.
- Hart can **reason via Ask HartOS** (LLM, with honest uncertainty) by **text or voice**.
- The cockpit shows a **true fleet priority briefing**.
- Hart can **mutate internal HartOS proposal state** from the Mutation Center (reject/archive/expire).
- Hart can **add a ClickUp comment** and **move a ClickUp card** through an approved transition.
- **Every action is typed, dry-runnable, approved, gated, audited (before+after), and correctable.**
- **Nothing self-approves; nothing executes from voice; no secret reaches a prompt; the Worker holds no
  write key.**

---

## 12. Risks + anti-drift rules
- **Split-brain stores:** all cockpit mutations write the **Supabase spine** (Worker reads anon). Never
  mutate the filesystem queue from the cockpit. *Drift check: one source of truth per surface.*
- **Adapter sprawl with bespoke gates:** every adapter routes through the ONE
  `checkExecutionPrecondition`. *Drift check: grep for any execute path that skips the gate.*
- **Vague mutation creep:** no action without a confirmed `targetId` + `targetName`. *Drift check:
  reject any TypedActionProposal missing a target.*
- **External token leakage:** ClickUp/LLM tokens live in Node/Edge secrets, never the Worker. *Drift
  check: doctrine-conformance scan of the Worker bundle for tokens/keys (extend the existing pg-scan).*
- **Confidence laundering:** the synthesizer/LLM may never report confidence above its inputs. *Drift
  check: a test asserting output confidence ≤ min(input confidences).*
- **Irreversible-action smuggling:** deploy/spend/external-delete are excluded or gated; the gate
  refuses unknown `actionType`s by default (allowlist, not denylist).
- **Idempotency gaps on external writes:** every external mutation carries an idempotency key; a re-run
  must be a no-op. *Drift check: idempotent-re-run test per external adapter.*
- **Plan thinness:** ship MVP vertical slices that are REAL end-to-end, not broad machinery over thin
  reality. If a slice can't be proven live, it isn't done.

---

## 13. Truth Table — what HartOS can and cannot do after this plan
**CAN:**
- Create/officiate **one read-only agent** end-to-end from a spec.
- Reason through **Ask HartOS** (LLM, honest uncertainty, cites freshness/gaps).
- Accept **voice input** (ask only).
- Show a **fleet priority briefing**.
- **Mutate internal HartOS proposal state** (reject/archive/expire/mark) from the cockpit.
- **Add ClickUp comments.**
- **Move ClickUp cards** through approved transitions.
- **Audit every action** (before + after, append-only).

**CANNOT:**
- Self-approve.
- Execute from voice.
- Mutate money/banking.
- Broadly mutate arbitrary external systems (only ClickUp comment + move, single-target).
- Deploy or spend without Hart's approval.
- Hide uncertainty / launder confidence.
- Put a secret in a prompt or a write key in the Worker.
- Delete or bulk-mutate anything external.

---
*The floor never moves. "Three levels up" = more closed-loop, more conversational, more intelligent,
and now genuinely able to mutate — with Hart as the pilot of every consequential action.*
