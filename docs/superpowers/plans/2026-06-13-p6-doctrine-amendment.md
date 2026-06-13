# P6 ① — Doctrine Amendment §6 (Constitution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the constitutional amendment that *authorizes* bounded autonomous self-modification — `docs/CONSTITUTION.md` §6, the amended doctrine clauses, the new `self-modification` clause, and the conformance assertions that pin self-mod **fail-closed by default**. Changes no runtime behavior; arms nothing.

**Architecture:** Strictly governance. `doctrine.ts` is pure/Worker-safe — it imports `isSelfModArmed` (the pure amendment-gate) and adds a fail-closed self-mod assertion to `checkDoctrineInvariants()`. The public-Worker fence (path a: `ACTION_EXECUTION`/`executeProposal`/`executionAllowed`) is untouched; self-mod rides the host path (b). The conformance test (CI gate) is amended in the same change so the build fails if self-mod ever becomes armed-by-default or the kill-switch stops dominating.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `node:test` + `node:assert/strict`, build via `tsc`, tests run as `node --test "dist/tests/*.test.js"`. Reference spec: `docs/superpowers/specs/2026-06-13-p6-constitution-self-mod-design.md`.

---

## File Structure

- **Create `docs/CONSTITUTION.md`** — the written §6 Hart formally ratifies; human-readable governance.
- **Modify `src/doctrine/doctrine.ts`** — amend the `human-approval` + `fail-closed` clause rules, add the `self-modification` clause, import `isSelfModArmed`, extend `checkDoctrineInvariants()` with the self-mod fail-closed assertion.
- **Modify `tests/doctrine-conformance.test.ts`** — add assertions: self-mod fail-closed default + kill-switch dominance, the `self-modification` clause present, the `human-approval` rule carries the carve-out, and `checkDoctrineInvariants()` still `[]`.

---

## Task 1: The written Constitution (§6)

**Files:**
- Create: `docs/CONSTITUTION.md`

- [ ] **Step 1: Create `docs/CONSTITUTION.md`**

```markdown
# HartOS Constitution

The HartOS doctrine is enforced as code (`src/doctrine/doctrine.ts`) and rendered to `DOCTRINE.md`. This Constitution holds the **amendments** — deliberate, ratified changes to a foundational rule. An amendment is in force only when (a) this document records it as ratified, AND (b) its machine-checked arming conditions are met.

## Amendment §6 — Bounded Autonomous Self-Modification

**Status:** DRAFTED — not ratified. Self-mod is disarmed until Hart ratifies §6 here AND sets the arming flags.

### Why
HartOS should be able to fix its own bugs, recalibrate its own logic from its track record, and extend its own capabilities — without a human hand-editing the code each time. §6 grants that, narrowly and reversibly.

### What it amends
The **Human-approval floor** ("Nothing executes without Hart's explicit, per-action approval") is amended to carve a bounded exception: the auto-apply self-mod classes are **pre-authorized** by this ratified amendment + a class flag, and **notify-after** instead of approve-before. Every other action — and the entire public-Worker fence — is unchanged.

### The grant (bounded)
HartOS may modify its own `src/` runtime, under a permanent gauntlet:

- **Armed only** when this §6 is ratified AND `HARTOS_SELFMOD_AMENDMENT_APPROVED=true` AND `HARTOS_ALLOW_SELF_MOD=true` AND `HARTOS_EXECUTION_KILL_SWITCH≠on`. Default OFF.
- **Classes:** *fix* (bug/drift repair) and *recalibrate* (own thresholds/rules) may **auto-apply** — commit → push → CI auto-deploy → notify Hart after. *Extend* (new capabilities) is **propose-only** — it waits for Hart's approval.
- **Blast-radius cap:** an auto-apply change must be small (≤ 5 files AND ≤ 150 changed lines). Over the cap → escalates to propose-only, even a "fix".
- **Always-on gates (every class):** clean git baseline → in-scope only (own runtime; **never** the doctrine, the self-mod machinery, the dispatch/verify/audit spine, the secret detector, mutation adapters, or secrets/deploy config) → the full test suite passes (including this doctrine conformance test) → no secret in the diff → fully reversible.
- **Post-deploy net:** after an auto-deploy, the smoke/health check runs. On failure → auto-revert to the last-good SHA + **disarm self-mod** + Telegram-alert Hart.
- **Circuit breaker:** a post-deploy failure disarms self-mod (Hart re-arms). A rate cap (≤ 1 auto-deploy/hour) bounds a misfiring loop.
- **The kill-switch (`HARTOS_EXECUTION_KILL_SWITCH`) overrides everything, always.**

### What it does NOT touch
The public Cloudflare Worker stays permanently execution-disabled (path a). Self-mod runs only on the trusted local daemon (path b). Breaking the public edge still yields only a read-only dashboard.

### Ratification
To ratify: change **Status** above to `RATIFIED <date>`, then set the two arming flags. The enforcing machinery (the auto-deploy pipeline, post-deploy net, classifier, circuit breaker) MUST be built and tested before ratification — do not arm a grant whose guardrails do not yet exist in code.

---

🤖 Drafted with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 2: Verify the file exists**

Run: `ls docs/CONSTITUTION.md`
Expected: the path prints (file created).

- [ ] **Step 3: Commit**

```bash
git add docs/CONSTITUTION.md
git commit -m "docs(p6): CONSTITUTION.md — Amendment §6 (drafted, not ratified)"
```

---

## Task 2: Amend the doctrine + conformance assertions

**Files:**
- Modify: `src/doctrine/doctrine.ts`
- Modify: `tests/doctrine-conformance.test.ts`

- [ ] **Step 1: Write the failing conformance assertions**

In `tests/doctrine-conformance.test.ts`, add this import after the existing `import { DOCTRINE, ... } from "../src/doctrine/doctrine.js";` line:

```typescript
import { isSelfModArmed } from "../src/doctrine/amendment-gate.js";
```

Then add this `describe` block at the end of the file (after the existing `describe("doctrine conformance (2.1)", ...)` block):

```typescript
describe("Amendment §6 — self-mod is fail-closed by default", () => {
  it("self-mod arms ONLY behind the full AND of three conditions", () => {
    assert.equal(isSelfModArmed({ amendmentApproved: false, classFlagArmed: false, killSwitchOn: false }), false);
    assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: false, killSwitchOn: false }), false);
    assert.equal(isSelfModArmed({ amendmentApproved: false, classFlagArmed: true, killSwitchOn: false }), false);
    assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: false }), true);
  });

  it("the kill-switch dominates the amendment", () => {
    assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: true }), false);
  });

  it("the doctrine carries a self-modification clause", () => {
    const clause = DOCTRINE.find((c) => c.id === "self-modification");
    assert.ok(clause, "expected a 'self-modification' clause in the doctrine");
    assert.ok(clause!.rule && clause!.enforcedBy, "the self-modification clause must be complete");
  });

  it("the human-approval floor records the auto-apply carve-out", () => {
    const human = DOCTRINE.find((c) => c.id === "human-approval");
    assert.ok(human, "expected the human-approval clause");
    assert.match(human!.rule, /Amendment §6|auto-apply|self-mod/i);
  });

  it("the path-(a) Worker fence still holds (invariant gate clean)", () => {
    assert.deepEqual(checkDoctrineInvariants(), []);
  });
});
```

- [ ] **Step 2: Run the conformance test to verify the new assertions fail**

Run: `npm run build && node --test dist/tests/doctrine-conformance.test.js`
Expected: FAIL — the "self-modification clause" and "human-approval carve-out" assertions fail (clause absent, rule unchanged); the `isSelfModArmed` ones already pass.

- [ ] **Step 3: Amend `src/doctrine/doctrine.ts`**

(a) Add the import after the existing `import { executeProposal, executionAllowed, ActionExecutionDisabledError, type GateEnv } from "../cockpit/proposals/gates.js";` line:

```typescript
import { isSelfModArmed } from "./amendment-gate.js";
```

(b) Replace the `human-approval` clause object (currently `rule: "Nothing executes without Hart's explicit, per-action approval."`) with:

```typescript
  {
    id: "human-approval",
    title: "Human approval floor",
    rule: "Nothing executes without Hart's explicit, per-action approval — EXCEPT the Amendment §6 auto-apply self-mod classes (fix, recalibrate), which are pre-authorized by the ratified amendment + class flag, bounded by the self-mod gauntlet, and notify-after.",
    enforcedBy: "the approval spine (Phase 2.2 lifecycle) + the fail-closed precondition (Phase 2.5); the §6 carve-out is gated by amendment-gate isSelfModArmed",
  },
```

(c) Replace the `fail-closed` clause object with:

```typescript
  {
    id: "fail-closed",
    title: "Fail-closed",
    rule: "When in doubt, deny. Execution is disabled by default; only allowlisted, approved (or Amendment §6-authorized), audited, reversible actions ever run. The kill-switch disables every autonomous path.",
    enforcedBy: "ACTION_EXECUTION='disabled' + executionAllowed() hard-capped false + the Phase 2.5 precondition gate; self-mod gated fail-closed by amendment-gate isSelfModArmed",
  },
```

(d) Add this new clause object to the `DOCTRINE` array, immediately after the `fail-closed` clause (so it is the last clause):

```typescript
  {
    id: "self-modification",
    title: "Bounded autonomous self-modification (Amendment §6)",
    rule: "HartOS may modify its own src/ runtime only under a permanent gauntlet: armed by the ratified Amendment §6 + class flag + kill-switch off; clean baseline; in-scope only (never its own guardrails); full suite green; no secret; reversible. Fix/recalibrate auto-apply within a size cap; extend is propose-only; a failed post-deploy auto-reverts and disarms; the kill-switch dominates.",
    enforcedBy: "amendment-gate isSelfModArmed (fail-closed AND of three) + self-mod-scope-guard + pre/post-verify + self-mod-rollback + the executeSelfMod gauntlet (post-deploy revert wired in integration)",
  },
```

(e) In `checkDoctrineInvariants()`, add these checks immediately before the final `return v;`:

```typescript
  // Amendment §6: self-mod must be fail-closed — disarmed unless the full AND of three holds, and the
  // kill-switch must always dominate. A regression to the amendment-gate fails the build here.
  if (isSelfModArmed({ amendmentApproved: false, classFlagArmed: false, killSwitchOn: false })) {
    v.push({ clause: "self-modification", detail: "self-mod armed with no conditions set — must be fail-closed by default" });
  }
  if (isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: true })) {
    v.push({ clause: "self-modification", detail: "self-mod armed with the kill-switch ON — the kill-switch must dominate" });
  }
```

- [ ] **Step 4: Run the conformance test to verify it passes**

Run: `npm run build && node --test dist/tests/doctrine-conformance.test.js`
Expected: PASS — all assertions green, including the existing "renders DOCTRINE.md … covering all clauses" (the new clause is complete + rendered) and `checkDoctrineInvariants() === []`.

- [ ] **Step 5: Run the whole suite to confirm no regressions**

Run: `npm run build && node --test "dist/tests/*.test.js"`
Expected: PASS — full suite green (a clause added + two clause rules reworded + two new invariant assertions that pass; no behavior change).

- [ ] **Step 6: Commit**

```bash
git add src/doctrine/doctrine.ts tests/doctrine-conformance.test.ts
git commit -m "feat(doctrine): P6 — Amendment §6 clause + human-approval carve-out + fail-closed self-mod assertion"
```

---

## Self-Review

**Spec coverage** (§4 of the design — "Constitutional structure in code"):
- AMEND `human-approval` clause (carve-out) → Task 2(b) + the conformance assertion. ✅
- AMEND `fail-closed` clause prose → Task 2(c). ✅
- ADD `self-modification` clause → Task 2(d) + conformance assertion. ✅
- `docs/CONSTITUTION.md` → Task 1. ✅
- Extend `checkDoctrineInvariants()` (self-mod fail-closed default) → Task 2(e) + conformance assertions. ✅
- Amend `tests/doctrine-conformance.test.ts` (assert fail-closed default + path-a holds) → Task 2 Step 1. ✅
- Path-(a) fence untouched → no edits to `ACTION_EXECUTION`/`executeProposal`/`executionAllowed`; the "path-(a) still holds" test pins it. ✅

**Placeholder scan:** every step has complete content (full CONSTITUTION.md, exact clause objects, exact test code, exact commands). No TBD/TODO. ✅

**Type consistency:** `isSelfModArmed` imported identically in `doctrine.ts` and the test; its `AmendmentGateInput` fields (`amendmentApproved`/`classFlagArmed`/`killSwitchOn`) match its definition in `amendment-gate.ts`; clause objects match the `DoctrineClause` interface (`id`/`title`/`rule`/`enforcedBy`). ✅

**Disarmed:** nothing here arms self-mod; the new assertions *prove* it's disarmed-by-default; no runtime behavior changes. ✅
