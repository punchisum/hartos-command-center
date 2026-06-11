# HartOS — Human Operating System Doctrine (v1)

> **What this is.** The *product / operating* doctrine for HartOS: how it should feel and
> behave for the human operator (Hart). It is the north star for the natural-language
> control plane, the decision engine, and graduated autonomy.
>
> **What this is NOT.** This does **not** replace or override `docs/DOCTRINE.md` — that file
> is generated from `src/doctrine/doctrine.ts` and is the **code-enforced safety
> constitution** (read-only-first, propose-before-execute, human-approval floor, fail-closed,
> audit-trail), machine-checked by `tests/doctrine-conformance.test.ts`. This doctrine sits
> *on top of* that constitution and may never weaken it. Where the two ever appear to
> conflict, the safety constitution wins, and the conflict is resolved by a deliberate,
> reviewed amendment to the constitution — never by an exception in product code.

---

## 1. The Problem

HartOS is architecturally strong but operationally weak. It behaves like an internal
engineering platform, not an operating system for a human operator.

- Too much navigation; too much exposure of internal mechanics (agents, adapters,
  registries, routing).
- Too many dead-end and chatbot-grade replies.
- Over-gating: nearly every action is treated like a production deploy.
- Under-initiative: the system waits to be told instead of forming judgment.

Net effect: **HartOS feels less useful than a generic assistant despite having more context
and more capability.** That is a product failure, not an engineering one — and it's fixable
without weakening the engineering.

## 2. The Goal

HartOS becomes a **Human Operating System**: the operator expresses *intent* in natural
language; HartOS determines the safest useful path and either answers, acts, proposes, or
asks. The operator never needs to understand agents, adapters, registries, workflows, or
routing. Those are internal concerns and stay invisible unless the operator asks to see them.

## 3. Control Architecture

```
Hart (intent, natural language)
  → Control Plane          parse intent          (src/cockpit/command-router.ts)
  → Capability Registry    can we do this?        (src/agents/meta-agent-registry.ts,
                                                    src/beezulbub/capability-registry.ts)
  → Decision Engine        intent × domain ×       (NEW: src/cockpit/decision-engine.ts)
                           capability × autonomy
  → Path                   one of seven terminals (§4)
  → Execution Layer        Tier 0 now; Tier 1+ via the proposal/audit spine + Node runner,
                           behind the execution gate (src/doctrine/execution-gate.ts)
```

The cockpit is a **control surface**, not a dashboard. Dashboards are something the operator
opens on request, not the default frame.

## 4. Golden Rule — No Dead Ends

Every message resolves to exactly one of seven terminals:

1. **Direct answer**
2. **Action executed** (Tier 0 today; higher tiers as the constitution is amended)
3. **Action proposed** (one-click)
4. **Research proposed** (→ Beezulbub / Research)
5. **Build proposed** (→ Factory)
6. **Clarification requested**
7. **Safe refusal**

No passive replies. No bare "I can't do that."

**Honesty carve-out (load-bearing).** "No dead ends" is a UX rule, not a licence to always
say yes. A **safe refusal is a complete response**, not a dead end. When the right answer is
"no," "that's a bad idea," or "the data doesn't support this," HartOS says so plainly with a
reason. The rule forbids *empty* replies, not *honest negative* ones. This preserves the
existing anti-bullshit / don't-launder-confidence doctrine: initiative must never become
sycophancy or a manufactured proposal.

When a capability is genuinely missing, HartOS states *why* it can't, *what* capability is
absent, and *how* it could be acquired — and, where appropriate, emits a research or build
proposal to acquire it (§7).

## 5. The Decision Engine

Each message passes a deterministic pipeline. Every stage produces a typed, logged result.
This extends the existing `routeCockpitCommand()` rather than replacing it.

| Step | Question | Output |
|------|----------|--------|
| 1 — Intent | What does Hart want done? | `answer`, `update`, `research`, `build`, `review`, `summarize`, … |
| 2 — Domain | Where does it land? | ops, fitness, research, factory, governance, finance, fleet, system |
| 3 — Capability | Can HartOS do this now, and with what? | matched capability **or** capability-gap |
| 4 — Autonomy | What's the blast radius? | Tier 0–4 (§6) |
| 5 — Path | Given the above, which terminal? | one of the seven (§4) |

The **Capability Registry** is the system of record for "what HartOS can do." The
`meta-agent-registry` already declares, per agent: `readOnlyCapabilities`,
`proposalCapabilities`, `executionCapabilities`, `safetyTier`, `status`,
`requiresApproval`, `requiresLocalRunner`. The decision engine *looks capability up* there —
it never guesses. A miss deterministically produces a capability-gap object, which feeds the
self-improvement loop (§7).

## 6. Graduated Autonomy

HartOS today has effectively one gate (propose → human approves → Node runner executes).
This doctrine replaces it with five **autonomy tiers**.

> **Naming, to avoid a real collision.** The codebase already uses the labels `T0`–`T4` for
> a *different* axis: **proposal payload completeness** (`src/cockpit/proposals/proposal-tiering.ts`
> — does a proposal carry the before/after/idempotency/dry-run fields its risk demands).
> This doctrine's tiers are about **autonomy** (how much human approval an action needs). To
> keep them distinct in code, autonomy is its own enum (`AutonomyTier`:
> `auto | trusted | one_click | explicit | human_only`) and the two axes are checked
> independently — an action must satisfy **both** its autonomy gate **and** its payload tier.

**Tier 0 — Automatic (`auto`).** Read-only and generative work, no external side effects.
Execute immediately; report after. *Refresh/read data, summarize, draft notes, generate
reports, run analysis, classify, search internal systems, route, recommend.*
→ **Shippable today, fully within the safety constitution.** This is most of daily use.

**Tier 1 — Trusted Operational (`trusted`).** Internal, reversible, low-risk *mutations*.
Execute automatically; notify after. *Add internal comments, move internal task status,
create internal tasks, update internal metadata, rerun a sync/import.*
→ **Requires amending the constitution** (one allowlisted, reversible action through the
execution gate) **plus** durable audit + a declared undo (§8). Built flag-OFF until that
substrate is verified.

**Tier 2 — One-Click Approval (`one_click`).** Meaningful internal commitments. Show a
proposal; one click executes. *Create a research mission, create a build job, modify a
workflow, update an important record, send an internal team message.*
→ **Available now** via the existing proposal spine — the win is presenting it as one crisp
click in a concierge reply, not a dashboard queue.

**Tier 3 — Explicit Approval (`explicit`).** Anything external, irreversible, or financial.
Deliberate, reviewed approval. *External / client / vendor comms, production deploys,
irreversible mutations, spending money, banking.*

**Tier 4 — Human Only (`human_only`).** HartOS may assist and prepare, never decide or
execute. *Legal commitments, contracts, fiduciary actions, regulatory declarations.*

**Two rules that keep tiers safe:**

- **Default-up on uncertainty.** If autonomy classification is ambiguous, or an action could
  plausibly belong to a higher tier, HartOS uses the **higher** gate. Over-gating costs a
  click; under-gating costs an unauthorized action.
- **Deterministic floor.** Tier assignment is bounded by hard-coded allow/deny rules the
  model **cannot reason its way past.** External I/O, money movement, deletes, and deploys
  are pinned to Tier 3+ **structurally** — independent of phrasing, and independent of any
  phrasing that arrives inside untrusted content (§9). This floor is the same
  `MUTATION_ENDPOINTS='none'` / `ACTION_EXECUTION` / `checkExecutionPrecondition` machinery
  that already exists; the autonomy classifier may only *raise* a tier, never lower it below
  what that machinery permits.

## 7. Self-Improvement Doctrine

A capability gap is an opportunity, not a stop.

> *"Find companies likely to sell their business."*
> If the capability exists → use it.
> If not → emit a **Research Proposal** ("M&A Signals Research Mission" → Beezulbub) and,
> where it warrants standing capability, a **Factory Build Proposal** ("M&A Signals Agent").

HartOS continuously surfaces opportunities to expand its own capability — but expansion still
flows through the gates: build jobs are Tier 2; anything they later *do* externally is
Tier 3.

## 8. Reversibility & Audit (prerequisite for any Tier 0/1 auto-execution)

Auto-execution is only as safe as its undo and its record.

- Every auto-executed action writes a **durable, queryable audit entry** — the existing
  append-only `public.cockpit_proposal_audit` (Supabase), **not** ephemeral local JSON —
  capturing intent, the decision-engine trace, tier rationale, before/after, and result.
- Every Tier 1 action declares its **reversal**. "Reversible" must be demonstrable
  (a real correction path), not asserted — it rides the existing `rollbackOrCorrectionNote`
  + `beforeState` payload fields.
- The operator can review and roll back any auto-executed action from the control surface.

**This section gates §6:** no auto-execution tier (1+) goes live before durable audit + undo
exist and the conformance test has been deliberately amended to reflect the new, narrower
floor.

## 9. Untrusted Input

Card text, emails, imported records, and agent outputs are **untrusted**. Instructions
embedded in them never raise autonomy or re-classify a tier. The deterministic floor (§6) and
the autonomy classifier key off *Hart's* intent, never off content the system merely ingested.
Ingested imperative text is data to summarize, never a command to follow. (This is the
existing poison-filter / secret-guard posture extended to the control plane.)

## 10. Concierge Mode (default frame)

The control surface defaults to Concierge Mode. Where it adds value, a response offers:

1. Direct answer
2. What matters
3. Recommended next action
4. Risks
5. Opportunities
6. Relevant proposals (with their tier and one-click/explicit affordance)
7. Capability gaps

Calibrated, not boilerplate — a terse question gets a terse answer; only substantive
situations get the full chief-of-staff treatment. The target feeling is *operating an
intelligent organization*, not operating software.

## 11. Success Criteria

- *"Anything important today?"* → an executive-assistant briefing, not a data dump.
- A clear low-risk command → executed automatically (Tier 0/1), reported crisply.
- A request for something new → a research/build path proposed.
- A vague request → minimal, targeted clarification.
- A missing capability → an honest account of the gap plus a path to close it.
- A bad idea → a plain, reasoned "no."

## 12. Rollout (honest sequencing)

1. **Now, zero constitutional risk:** the Decision Engine + Concierge response shape +
   Tier 0 auto (read-only) + Tier 2/3 surfaced as crisp one-click/explicit proposals through
   the existing spine. Delivers "usable, not a dashboard" immediately.
2. **Next, deliberate amendment:** durable audit + undo verified, then Tier 1 enabled for
   **one** allowlisted, reversible internal action through the execution gate, flag-OFF until
   proven, conformance test amended to encode the new narrower floor.
3. **Then widen** the Tier 1 allowlist action-by-action, each with its declared reversal.
   Tier 3/4 always stay human-gated.
