# P6 (foundation) — Self-Mod Verification Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two pure, fail-closed verification gates that wrap an autonomous self-modification — a **pre-verify** that refuses to start unless the working tree is clean and captures a baseline anchor, and a **post-verify** that decides whether an edit is safe to keep (in-scope paths only, no secret leak). Neither arms anything; both compose with the existing scope-guard and W3's git baseline.

**Architecture:** Two small additions to `src/execution/`. `self-mod-post-verify.ts` is fully pure — it reuses `isInSelfModScope` (scope-guard, already exists) and `containsSecret` (redaction, already exists) to flag violations in a set of changed files + a diff string. `self-mod-pre-verify.ts` reuses W3's `captureBaseline`/`GitProbe` (injectable, hermetic) to record a HEAD anchor and refuse a dirty tree. These are the gates that a later P6 plan's self-mod-executor will call (pre → run W3's hand → post → rollback-on-fail), and that rollback (a later plan) will key off. Nothing here touches `ACTION_EXECUTION`/`executionAllowed`/`executeProposal` — the doctrine fence stays hard-capped disabled; arming is the Constitutional Amendment in a separate, later, gated plan.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `node:test` + `node:assert/strict`, build via `tsc`, tests run as `node --test "dist/tests/*.test.js"`.

---

## Existing pieces these gates compose with (do NOT recreate)

- `src/execution/self-mod-scope-guard.ts` → `isInSelfModScope(path: string): { allowed: boolean; reason: string }` — fail-closed per-path allow/deny (only `src/`, denies `..`, `.env`/secret/`.key`/`wrangler*.toml`, `src/execution/adapters/`).
- `src/llm/redaction.ts` → `containsSecret(text: string): boolean` — true if text matches a secret-shaped pattern.
- `src/execution/claude-exec-baseline.ts` (W3, on trunk) → `captureBaseline(cwd, git?)`, types `GitProbe`, `ExecBaseline { headSha: string; preexistingDirty: string[] }`, `realGitProbe`.

## File Structure

- **Create `src/execution/self-mod-post-verify.ts`** — pure. `postVerifySelfMod(changedFiles, diffText) → { ok, violations }`. One responsibility: decide if a completed self-mod edit is safe to keep.
- **Create `src/execution/self-mod-pre-verify.ts`** — injectable. `preVerifySelfMod(cwd, git?) → { ok, baseline?, reason }`. One responsibility: refuse a dirty tree and capture the clean rollback anchor.
- **Create `tests/self-mod-post-verify.test.ts`**, **`tests/self-mod-pre-verify.test.ts`**.

**Out of scope (later P6 plans, intentionally deferred — not silently missing):**
- `self-mod-rollback.ts` (6.5) — git working-tree restore to the baseline; pairs with the executor and needs careful side-effect design (incl. W3's noted `git status --porcelain -z` hardening for renames/quoted paths).
- `self-mod-executor.ts` (6.6) — orchestrates amendment-gate → pre-verify → run W3's `runClaudeTask` → **run the test suite as a subprocess** (this is where "doctrine still holds + tests pass" is truly verified, since `checkDoctrineInvariants()` in-process reflects loaded modules, not the on-disk diff) → post-verify → rollback-on-fail.
- `docs/CONSTITUTION.md` + the doctrine invariant rewrite + `amendment-gate` wiring (6.1/6.7) — the arming step, a separate formally-gated plan.

---

## Task 1: Post-verify gate (pure)

**Files:**
- Create: `src/execution/self-mod-post-verify.ts`
- Test: `tests/self-mod-post-verify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/self-mod-post-verify.test.ts`:

```typescript
/**
 * tests/self-mod-post-verify.test.ts — P6: the post-modification safety gate (pure, fail-closed).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postVerifySelfMod } from "../src/execution/self-mod-post-verify.js";

describe("postVerifySelfMod", () => {
  it("ok when all files are in scope and no secret leaks", () => {
    const r = postVerifySelfMod(["src/cockpit/cockpit.ts", "src/fitness/coaching-core.ts"], "+ const x = 1;");
    assert.equal(r.ok, true);
    assert.deepEqual(r.violations, []);
  });

  it("flags an out-of-scope file (mutation adapter)", () => {
    const r = postVerifySelfMod(["src/execution/adapters/clickup-comment.ts"], "+ x");
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].kind, "out-of-scope");
    assert.match(r.violations[0].detail, /clickup-comment/);
  });

  it("flags a file outside src/", () => {
    const r = postVerifySelfMod(["package.json"], "+ x");
    assert.equal(r.ok, false);
    assert.equal(r.violations[0].kind, "out-of-scope");
  });

  it("flags a secret leak in the diff", () => {
    const r = postVerifySelfMod(["src/cockpit/cockpit.ts"], '+ const k = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";');
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.kind === "secret-leak"));
  });

  it("accumulates multiple violations (out-of-scope + secret)", () => {
    const r = postVerifySelfMod(
      ["src/execution/adapters/refresh-sync.ts"],
      '+ token = "sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"',
    );
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.kind === "out-of-scope"));
    assert.ok(r.violations.some((v) => v.kind === "secret-leak"));
  });

  it("empty change set is vacuously ok", () => {
    const r = postVerifySelfMod([], "");
    assert.equal(r.ok, true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build`
Expected: FAIL — `tsc`: `Cannot find module '../src/execution/self-mod-post-verify.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/execution/self-mod-post-verify.ts`:

```typescript
/**
 * src/execution/self-mod-post-verify.ts — Phase 6: the post-modification safety gate (PURE).
 *
 * After a self-mod run edits the working tree, decide whether the change is SAFE TO KEEP. Fail-closed:
 * the verdict is ok ONLY if every changed path is in self-mod scope (isInSelfModScope) AND no diff
 * content leaks a secret (containsSecret). A non-ok verdict is the executor's signal to roll back.
 *
 * NOTE: "doctrine still holds + tests pass" is deliberately NOT checked here — checkDoctrineInvariants()
 * reads the already-loaded runtime, not the on-disk diff, so that guarantee belongs to the executor
 * running the test suite as a fresh subprocess. This gate is the pure, in-process half. No git/fs/process.
 */
import { isInSelfModScope } from "./self-mod-scope-guard.js";
import { containsSecret } from "../llm/redaction.js";

export interface SelfModViolation {
  kind: "out-of-scope" | "secret-leak";
  detail: string;
}

export interface PostVerifyResult {
  ok: boolean;
  violations: SelfModViolation[];
}

/** Decide whether a completed self-mod edit (its changed files + unified diff text) is safe to keep. */
export function postVerifySelfMod(changedFiles: string[], diffText: string): PostVerifyResult {
  const violations: SelfModViolation[] = [];

  for (const file of changedFiles) {
    const scope = isInSelfModScope(file);
    if (!scope.allowed) {
      violations.push({ kind: "out-of-scope", detail: `${file}: ${scope.reason}` });
    }
  }

  if (containsSecret(diffText)) {
    violations.push({ kind: "secret-leak", detail: "the diff contains a secret-shaped token" });
  }

  return { ok: violations.length === 0, violations };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/tests/self-mod-post-verify.test.js`
Expected: PASS — all 6 cases green. (If a secret-pattern assertion fails, inspect `src/llm/redaction.ts`'s `SECRET_PATTERNS` and adjust the test's sample token to a string that `containsSecret` matches — do NOT weaken the implementation.)

- [ ] **Step 5: Commit**

```bash
git add src/execution/self-mod-post-verify.ts tests/self-mod-post-verify.test.ts
git commit -m "feat(self-mod): P6 — post-verify gate (in-scope paths + no secret leak, fail-closed)"
```

---

## Task 2: Pre-verify gate (injectable)

**Files:**
- Create: `src/execution/self-mod-pre-verify.ts`
- Test: `tests/self-mod-pre-verify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/self-mod-pre-verify.test.ts`:

```typescript
/**
 * tests/self-mod-pre-verify.test.ts — P6: the pre-modification gate (clean-baseline anchor, fake git).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preVerifySelfMod } from "../src/execution/self-mod-pre-verify.js";
import { type GitProbe } from "../src/execution/claude-exec-baseline.js";

function fakeGit(head: string, dirty: string[]): GitProbe {
  return { headSha: () => head, dirtyPaths: () => dirty };
}

describe("preVerifySelfMod", () => {
  it("ok on a clean tree — captures the baseline anchor", () => {
    const r = preVerifySelfMod("/repo", fakeGit("sha-abc", []));
    assert.equal(r.ok, true);
    assert.equal(r.baseline?.headSha, "sha-abc");
    assert.deepEqual(r.baseline?.preexistingDirty, []);
  });

  it("refuses a dirty tree (self-mod needs a clean baseline)", () => {
    const r = preVerifySelfMod("/repo", fakeGit("sha-abc", ["src/already.ts"]));
    assert.equal(r.ok, false);
    assert.match(r.reason, /not clean/i);
    // baseline is still returned for diagnostics.
    assert.equal(r.baseline?.headSha, "sha-abc");
  });

  it("refuses when the baseline cannot be captured (not a git repo)", () => {
    const broken: GitProbe = {
      headSha: () => { throw new Error("not a git repo"); },
      dirtyPaths: () => [],
    };
    const r = preVerifySelfMod("/repo", broken);
    assert.equal(r.ok, false);
    assert.match(r.reason, /cannot capture baseline/i);
    assert.equal(r.baseline, undefined);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build`
Expected: FAIL — `tsc`: `Cannot find module '../src/execution/self-mod-pre-verify.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/execution/self-mod-pre-verify.ts`:

```typescript
/**
 * src/execution/self-mod-pre-verify.ts — Phase 6: the pre-modification gate.
 *
 * Before a self-mod run touches the working tree, capture a clean rollback anchor: the tree MUST be
 * clean (so the post-run diff is purely the self-mod's, and rollback is exact), and we record the
 * baseline (HEAD sha + the — required-empty — dirty set). Fail-closed: a dirty tree, or a cwd that is
 * not a git repo, refuses the run. Reuses W3's captureBaseline; injectable GitProbe so tests are hermetic.
 */
import { captureBaseline, realGitProbe, type GitProbe, type ExecBaseline } from "./claude-exec-baseline.js";

export interface PreVerifyResult {
  ok: boolean;
  /** The captured anchor — present whenever HEAD was readable (even on a dirty refusal, for diagnostics). */
  baseline?: ExecBaseline;
  reason: string;
}

/** Refuse unless the working tree is clean; return the baseline anchor the run/rollback will use. */
export function preVerifySelfMod(cwd: string, git: GitProbe = realGitProbe): PreVerifyResult {
  let baseline: ExecBaseline;
  try {
    baseline = captureBaseline(cwd, git);
  } catch (e) {
    return { ok: false, reason: `cannot capture baseline: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (baseline.preexistingDirty.length > 0) {
    return {
      ok: false,
      baseline,
      reason: `working tree not clean (${baseline.preexistingDirty.length} dirty path(s)) — self-mod needs a clean baseline`,
    };
  }
  return { ok: true, baseline, reason: "clean baseline captured" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/tests/self-mod-pre-verify.test.js`
Expected: PASS — all 3 cases green.

- [ ] **Step 5: Run the whole suite to confirm no regressions**

Run: `npm run build && node --test "dist/tests/*.test.js"`
Expected: PASS — full command-center suite green (only new tests added; no existing behaviour changed).

- [ ] **Step 6: Commit**

```bash
git add src/execution/self-mod-pre-verify.ts tests/self-mod-pre-verify.test.ts
git commit -m "feat(self-mod): P6 — pre-verify gate (clean-baseline anchor, fail-closed)"
```

---

## Self-Review

**Spec coverage** (P6 §6.3 pre-verify + §6.4 post-verify, the pure halves):
- *6.3 re-read baseline + capture rollback point* → `preVerifySelfMod` captures `ExecBaseline` (HEAD anchor) and enforces clean. The Sentinel/Wolverine health re-read is deferred (needs those modules; not load-bearing for the anchor). ✅ (partial-by-design, noted)
- *6.4 in-scope diff only + no secret leak* → `postVerifySelfMod` via `isInSelfModScope` + `containsSecret`. ✅ The "doctrine holds + tests pass" half is explicitly deferred to the executor's subprocess test-run (documented in the source + out-of-scope), because an in-process `checkDoctrineInvariants()` reflects loaded modules, not the on-disk diff. ✅
- *failure → rollback* → these gates only return the verdict; the executor (later plan) acts on it. ✅

**Placeholder scan:** every step has complete, runnable code/tests; no TBD/TODO. ✅

**Type consistency:** `SelfModViolation`/`PostVerifyResult` used identically in impl + test; `PreVerifyResult.baseline` is `ExecBaseline | undefined` and the tests use `r.baseline?.headSha` accordingly; `GitProbe` imported from the W3 module matches `preVerifySelfMod`'s param. The reused `isInSelfModScope` return shape (`{ allowed, reason }`) and `containsSecret(string): boolean` match their existing definitions. ✅

**Doctrine guard:** no reference to `ACTION_EXECUTION`/`executionAllowed`/`executeProposal`; nothing armed. ✅
