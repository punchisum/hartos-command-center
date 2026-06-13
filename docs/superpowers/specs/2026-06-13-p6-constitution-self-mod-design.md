# P6 Constitutional Amendment §6 — Bounded Autonomous Self-Modification (Design)

**Date:** 2026-06-13
**Status:** Approved design (interviewed with Hart). Next: implementation plan.
**Scope:** The governance design for HartOS Phase 6 — the constitution that authorizes (and bounds) autonomous self-modification. This document is the *contract*; the enforcing machinery is built to it.

---

## 1. Goal

Authorize HartOS to modify its own runtime code — to **fix** itself (repair bugs/drift in its own runtime), **recalibrate** itself (adjust its own thresholds/rules from its track record, the P8 angle), and **extend** itself (add new capabilities/agents) — under a permanent, machine-checked gauntlet, with autonomy **graduated by risk class**. The dangerous capability lives only on the trusted local daemon; the public Worker fence is never touched.

## 2. The two execution paths (why the structure is safe)

HartOS has two execution paths; only one is permanently disabled, and self-mod rides the other.

- **Path (a) — the public Cloudflare Worker executing actions.** Permanently disabled forever (`ACTION_EXECUTION='disabled'`, `executeProposal()` throws, `executionAllowed()` hard-capped false, enforced by `tests/doctrine-conformance.test.ts`). The Worker is the internet-facing edge and holds no secrets/DB keys; if it could mutate, a Worker compromise = direct write power + a path to credentials. The Worker reads; it never writes. The approve button only *records a decision* (a narrow capability-token status write), it never executes.
- **Path (b) — the trusted local Node daemon (`live-runner`).** Holds elevated credentials, runs gated/approved mutations (ClickUp, fitness/P5). **Self-mod rides path (b).** Breaking the public edge yields only a read-only dashboard.

**Architectural consequence:** the amendment never touches path (a). It adds self-mod as a separate, host-side, amendment-gated path. Strictly additive to the existing guarantees.

## 3. Governance substance (the binding rules)

### 3.1 Classes and tiers

| Capability | Tier | On passing all gates |
|---|---|---|
| **Fix** (bug/drift repair in own runtime) | **Tier 1 — auto-apply** | commit → push to trunk → **CI auto-deploys** → notify Hart after |
| **Recalibrate** (own thresholds/rules from track record, P8) | **Tier 1 — auto-apply** | same as Fix |
| **Extend** (new capabilities/agents) | **Tier 2 — propose-only** | becomes a cockpit proposal → waits for Hart's approval → then deploys |

### 3.2 Blast-radius cap (Tier 1 only)

Auto-apply requires the change to be small: **≤ ~5 files AND ≤ ~150 changed lines** (tunable). A Tier 1 change exceeding either bound **escalates to Tier 2** (propose-only) — even a "fix." Big rewrites always get Hart's eyes.

### 3.3 Always-on gates (every class, no exception)

Armed (§3.4) → **clean git baseline** → **in-scope only** (own `src/` runtime; *never* `src/doctrine/`, the self-mod machinery, the dispatch/verify/audit spine, `redaction.ts`, mutation adapters, secrets/deploy config — per the narrowed scope-guard) → **full test suite passes** (including the doctrine conformance test = "doctrine still holds") → **no secret in the diff** → **fully reversible** (git restore to the captured baseline).

### 3.4 Arming (fail-closed, AND of three)

Self-mod is armed **only** when: **amendment §6 ratified** (`HARTOS_SELFMOD_AMENDMENT_APPROVED=true`) **AND** the class flag on (`HARTOS_ALLOW_SELF_MOD=true`) **AND** the kill-switch off (`HARTOS_EXECUTION_KILL_SWITCH≠on`). Default OFF ⇒ disarmed. The **kill-switch overrides everything, always.**

### 3.5 Post-deploy safety net (Tier 1)

After an auto-deploy: run the post-deploy check (smoke test + health + deployed-SHA match). **On failure → automatically revert to the last-good SHA + redeploy + DISARM self-mod (no more auto-applies until Hart re-arms) + Telegram-alert Hart.** Self-heals and stops digging.

### 3.6 Circuit breaker + rate cap

A post-deploy failure disarms self-mod (Hart re-arms). A rate cap (proposed: **≤ 1 auto-deploy / hour**) prevents a misfiring loop from spamming prod.

## 4. Constitutional structure in code

This **amends the doctrine** — it is not merely additive. The substance is a genuine change to a foundational governance rule; only the *code structure* (the Worker fence) stays untouched.

- **AMEND the `human-approval` clause** (`doctrine.ts` `DOCTRINE` array). Today it reads *"Nothing executes without Hart's explicit, per-action approval."* This is the rule the amendment changes. New form: *"Nothing executes without Hart's approval, EXCEPT the amendment-authorized auto-apply self-mod classes (fix, recalibrate) — pre-authorized by the ratified §6 + class flag, bounded by the gauntlet, and notify-after."* This carve-out IS the constitutional amendment.
- **AMEND the `fail-closed` clause** prose to acknowledge the second, separately-gated execution path (self-mod on the host) so the doctrine doc reflects reality (the underlying path-(a) enforcement is unchanged).
- **ADD a new `self-modification` clause** to the `DOCTRINE` array (the full §3 rules + their `enforcedBy`).
- **Keep the path-(a) fence intact.** `ACTION_EXECUTION`, `executeProposal`, `executionAllowed` invariants are **unchanged** — the public Worker stays execution-disabled forever. Self-mod rides path (b).
- **`docs/CONSTITUTION.md`** (new) — the written §6 Hart formally ratifies; the human-readable governance text (the substance of §3).
- **Extend `checkDoctrineInvariants()`** with a **new assertion: self-mod is fail-closed by default** (`isSelfModArmed` returns false unless the three arming conditions hold).
- **`tests/doctrine-conformance.test.ts`** — amended *in the same PR* to assert the new fail-closed default + that the path-(a) invariants still hold, so CI fails the build if self-mod ever becomes armed-by-accident OR the Worker fence is ever weakened.

Rejected alternative: rewriting the central `executionAllowed` invariant into a conditional — more dangerous (touches the fence protecting *all* execution). Self-mod rides path (b) instead, so path (a) needs no change.

## 5. The operational gauntlet (every attempt)

1. **Armed?** (§3.4) — else skip.
2. **Clean baseline** — else skip.
3. **Run the hand** (W3 `runClaudeTask`) → edit the working tree → **compute the authoritative changed set** (`changedByRun` against the baseline; not the hand's self-report).
4. **Classify:** class + size.
5. **Gate chain** (§3.3): in-scope → full suite passes → no secret. Any fail → **rollback + stop**.
6. **Route by tier** (§3.1, with the §3.2 cap escalation):
   - **Tier 1:** commit → push to trunk → CI auto-deploys → **post-deploy verify** (§3.5). Pass → notify. Fail → auto-revert + disarm + alert.
   - **Tier 2:** create a cockpit proposal → Hart approves → deploy.
7. **Circuit breaker / rate cap** (§3.6). **Kill-switch dominates always.**

(The pure orchestration core of this gauntlet is already built + reviewed: `executeSelfMod` over injectable ports + `defaultSelfModPorts`, fully disarmed. Integration wires the Tier-1 auto-deploy + post-deploy net + classifier on top.)

## 6. Arming sequence & scope of work (safety-critical sequencing)

**The constitution is drafted now, but ratified + armed only AFTER the enforcing machinery exists and is tested.** You do not grant auto-deploy before the cap / post-deploy-net / tiering are implemented. The conformance test keeps self-mod disarmed-by-default until deliberate arming.

- **The amendment PR amends the doctrine *contract*** — `CONSTITUTION.md` §6 + the amended `human-approval`/`fail-closed` clauses + the new `self-modification` clause + the conformance assertions. This is a real governance change, but it changes **no runtime behavior** and **arms nothing** (the auto-deploy capability it authorizes does not exist until the integration is built; the conformance test pins disarmed-by-default).
- **Authorized by the constitution, deferred to integration (6.8–6.19) — the bulk of the build:** the Tier-1 auto-deploy pipeline, post-deploy verify+revert, the size/tier classifier, the circuit breaker + rate cap, the decision-engine self-mod intents, the `"self-mod"` ProposalDomain, the Wolverine self-mod-drift detector, the cockpit amendment/proposal panel, live-runner routing. Each is its own reviewed increment (the small-PR pattern P6 has used throughout).
- **Build order:** the doctrine amendment can land **early** (it only *adds checks* and asserts disarmed) → integration machinery built disarmed in increments → Hart ratifies §6 + arms last.
- **Arming sequence (all Hart's hands):** build + test the machinery (disarmed) → Hart **ratifies §6** (formal written approval) → Hart flips `HARTOS_SELFMOD_AMENDMENT_APPROVED` + `HARTOS_ALLOW_SELF_MOD` → self-mod live, kill-switch ready.

## 7. Safety invariants (must always hold)

- Disarmed by default; arming is the AND of three deliberate conditions; the kill-switch overrides all.
- Self-mod can never edit its own guardrails (doctrine, scope-guard, verifiers, rollback, the W3 hand/baseline, `redaction.ts`, the dispatch/verify/audit spine) — enforced by the narrowed scope-guard.
- The public Worker stays permanently execution-disabled (path (a) untouched).
- Every Tier-1 change is small (capped), tested-green, secret-free, reversible, and has an automatic post-deploy revert.
- A bad auto-deploy self-reverts and disarms — failure is loud and self-correcting, never silent.

## 8. Tunables / open items (decide during implementation)

- Cap thresholds (5 files / 150 lines) — starting values, tune from experience.
- Rate cap (1 auto-deploy/hour) — starting value.
- Exact post-deploy check composition (smoke + `/health` deployed-SHA + error-rate window).
- The integration-phase hardening backlog already logged in memory (test-subprocess timeout, ENOENT-only read handling, TOCTOU recompute, audit threading, Worker import-boundary guard, `-uall` enumeration, drift conformance test).
