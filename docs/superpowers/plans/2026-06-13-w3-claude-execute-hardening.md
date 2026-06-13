# W3 — Harden the `claude.execute` Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every run of the `claude.execute` hand auditable and bounded — anchored to a captured git baseline, restricted to an *asserted* code-edit-only tool scope, and reporting exactly which files it changed — so P6's self-mod guards have a trustworthy hand to wrap.

**Architecture:** Three small, single-responsibility additions to `src/execution/`. Two are pure/injectable units (a tool-scope guard and a git-baseline probe) built and tested in isolation; the third wires them into the existing `runClaudeTask` so the hand refuses to run when it can't audit itself, and returns the baseline SHA + the files attributable to the run. No change to `executionAllowed`/`executeProposal` (the hard-capped path stays disabled). The arm flag, kill-switch, token-strip, timeout, and "no Bash" tool list already exist — W3 turns the implicit guarantees into asserted, audited ones.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `node:test` + `node:assert/strict`, `node:child_process` `spawnSync` (no shell, no injection), build via `tsc`, tests run as `node --test "dist/tests/*.test.js"`.

---

## File Structure

- **Create `src/execution/claude-exec-tool-scope.ts`** — pure guard. Parses a comma-separated allowed-tools string and asserts every entry is on the code-edit allowlist; fail-closed on anything else (Bash, WebFetch, Task, …). One responsibility: prove the tool scope is harmless.
- **Create `src/execution/claude-exec-baseline.ts`** — git baseline capture + run attribution. Injectable `GitProbe` (real impl wraps `spawnSync git`). Captures HEAD SHA + already-dirty paths before a run; computes `dirty-after − dirty-before` after. One responsibility: anchor a run to a known git state and attribute its file changes.
- **Modify `src/execution/claude-task-executor.ts`** — wire the two units into `runClaudeTask`: assert scope and capture baseline *before* spawning (refuse, honest-skip, if either fails — an unauditable run is not allowed); compute changed files *after* a successful run; extend `ClaudeTaskResult` with `baselineSha` + `filesChanged`. Use the validated tool list in the spawn runner.
- **Create `tests/claude-exec-tool-scope.test.ts`**, **`tests/claude-exec-baseline.test.ts`** — unit tests for the two new units.
- **Modify `tests/claude-task-executor.test.ts`** — extend with baseline/scope behaviour (existing tests must still pass).

**Out of scope (W3 follow-up, separate task once `src/jobs/agent-job.ts` is read):** threading `baselineSha`/`filesChanged` into the job's persisted audit record. The executor returns them now; the caller surfacing them is a trivial wiring change scoped after reading `agent-job.ts`. P6 (self-mod guards: amendment-gate, scope-guard, pre/post-verify, rollback) is a *separate* plan that wraps this hardened hand.

---

## Task 1: Code-edit-only tool-scope guard (pure)

**Files:**
- Create: `src/execution/claude-exec-tool-scope.ts`
- Test: `tests/claude-exec-tool-scope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/claude-exec-tool-scope.test.ts`:

```typescript
/**
 * tests/claude-exec-tool-scope.test.ts — W3: the code-edit-only tool-scope guard (pure, fail-closed).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertCodeEditScope,
  CODE_EDIT_TOOLS,
} from "../src/execution/claude-exec-tool-scope.js";

describe("assertCodeEditScope", () => {
  it("accepts the exact code-edit tool list", () => {
    const v = assertCodeEditScope("Read,Edit,Write,Glob,Grep");
    assert.equal(v.safe, true);
    assert.deepEqual(v.tools, ["Read", "Edit", "Write", "Glob", "Grep"]);
  });

  it("tolerates whitespace and ordering", () => {
    const v = assertCodeEditScope(" Grep , Read ,Edit ");
    assert.equal(v.safe, true);
    assert.deepEqual(v.tools, ["Grep", "Read", "Edit"]);
  });

  it("fails closed when Bash is smuggled in", () => {
    const v = assertCodeEditScope("Read,Edit,Bash");
    assert.equal(v.safe, false);
    assert.match(v.reason, /Bash/);
  });

  it("fails closed on network/agent tools", () => {
    for (const bad of ["WebFetch", "WebSearch", "Task", "NotebookEdit"]) {
      const v = assertCodeEditScope(`Read,${bad}`);
      assert.equal(v.safe, false, `${bad} must be rejected`);
      assert.match(v.reason, new RegExp(bad));
    }
  });

  it("fails closed on an empty scope", () => {
    const v = assertCodeEditScope("   ");
    assert.equal(v.safe, false);
    assert.match(v.reason, /empty/);
  });

  it("CODE_EDIT_TOOLS contains no command/network tool", () => {
    for (const banned of ["Bash", "WebFetch", "WebSearch", "Task"]) {
      assert.equal(CODE_EDIT_TOOLS.includes(banned as never), false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build`
Expected: FAIL — `tsc` errors: `Cannot find module '../src/execution/claude-exec-tool-scope.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/execution/claude-exec-tool-scope.ts`:

```typescript
/**
 * src/execution/claude-exec-tool-scope.ts — W3: the code-edit-only tool-scope guard (PURE).
 *
 * The claude.execute hand must never be handed a tool that can run commands, reach the network, or
 * touch anything outside file edits. This turns "we pass --allowedTools Read,Edit,Write,Glob,Grep"
 * from a convention into an ASSERTED invariant: any tool not on the code-edit allowlist makes the
 * scope unsafe (fail-closed), so a future edit that smuggles in Bash is caught here, not in prod.
 */

/** The ONLY tools the execution hand may ever be given — file reads + edits, nothing else. */
export const CODE_EDIT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"] as const;

export interface ToolScopeVerdict {
  safe: boolean;
  /** The parsed, trimmed, non-empty tool list (in input order). */
  tools: string[];
  reason: string;
}

/** Parse a comma-separated allowedTools string and assert every tool is code-edit-only. Fail-closed. */
export function assertCodeEditScope(allowedTools: string): ToolScopeVerdict {
  const tools = allowedTools
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tools.length === 0) {
    return { safe: false, tools, reason: "empty tool scope" };
  }
  const allow = new Set<string>(CODE_EDIT_TOOLS);
  const offenders = tools.filter((t) => !allow.has(t));
  if (offenders.length > 0) {
    return { safe: false, tools, reason: `non-code-edit tool(s) in scope: ${offenders.join(", ")}` };
  }
  return { safe: true, tools, reason: "code-edit-only scope" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/tests/claude-exec-tool-scope.test.js`
Expected: PASS — all 6 assertions in the suite green.

- [ ] **Step 5: Commit**

```bash
git add src/execution/claude-exec-tool-scope.ts tests/claude-exec-tool-scope.test.ts
git commit -m "feat(execute): W3 — assert code-edit-only tool scope (fail-closed guard)"
```

---

## Task 2: Git-baseline capture + run attribution (injectable)

**Files:**
- Create: `src/execution/claude-exec-baseline.ts`
- Test: `tests/claude-exec-baseline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/claude-exec-baseline.test.ts` (uses a fake `GitProbe` — no real git):

```typescript
/**
 * tests/claude-exec-baseline.test.ts — W3: git baseline capture + run attribution (fake GitProbe).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  captureBaseline,
  changedByRun,
  type GitProbe,
  type ExecBaseline,
} from "../src/execution/claude-exec-baseline.js";

/** A scripted GitProbe: fixed head, and a queue of dirty-path snapshots returned in order. */
function fakeGit(head: string, snapshots: string[][]): GitProbe {
  let i = 0;
  return {
    headSha: () => head,
    dirtyPaths: () => snapshots[Math.min(i++, snapshots.length - 1)],
  };
}

describe("captureBaseline", () => {
  it("records the HEAD sha and the pre-existing dirty paths", () => {
    const git = fakeGit("abc123", [["src/dirty-already.ts"]]);
    const base = captureBaseline("/repo", git);
    assert.equal(base.headSha, "abc123");
    assert.deepEqual(base.preexistingDirty, ["src/dirty-already.ts"]);
  });
});

describe("changedByRun", () => {
  it("attributes only NEW dirty paths to the run", () => {
    // before: one already-dirty file; after: that file + two the run touched.
    const git = fakeGit("abc123", [
      ["src/dirty-already.ts"],
      ["src/dirty-already.ts", "src/new-a.ts", "src/new-b.ts"],
    ]);
    const base = captureBaseline("/repo", git);
    const changed = changedByRun("/repo", base, git);
    assert.deepEqual(changed.sort(), ["src/new-a.ts", "src/new-b.ts"]);
  });

  it("returns [] when the run touched nothing", () => {
    const git = fakeGit("abc123", [["src/x.ts"], ["src/x.ts"]]);
    const base = captureBaseline("/repo", git);
    assert.deepEqual(changedByRun("/repo", base, git), []);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build`
Expected: FAIL — `tsc` errors: `Cannot find module '../src/execution/claude-exec-baseline.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/execution/claude-exec-baseline.ts`:

```typescript
/**
 * src/execution/claude-exec-baseline.ts — W3: capture a git baseline for an execution run and
 * attribute the changed files to it. Injectable GitProbe so tests are hermetic (no real git).
 *
 * The hand edits the working tree (never commits/pushes). To make a run auditable, we record the
 * HEAD sha and the paths already dirty BEFORE the run; afterwards the files attributable to the run
 * are (dirty after) − (dirty before). W3 only CAPTURES this; P6's pre/post-verify enforce a clean
 * baseline + a rollback point on top of it. All git calls use spawnSync (no shell, no injection).
 */
import { spawnSync } from "node:child_process";

export interface GitProbe {
  /** `git rev-parse HEAD`. Throws if the cwd is not a git repo (an unauditable run must not proceed). */
  headSha(cwd: string): string;
  /** Porcelain dirty paths (untracked + modified), one path per entry. */
  dirtyPaths(cwd: string): string[];
}

export interface ExecBaseline {
  headSha: string;
  /** Paths already dirty before the run — NOT attributable to it. */
  preexistingDirty: string[];
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string } {
  // 64MB buffer mirrors local-git.ts — large repos can emit big status/diff output.
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  return { ok: (r.status ?? 1) === 0, stdout: (r.stdout ?? "").trim() };
}

export const realGitProbe: GitProbe = {
  headSha(cwd: string): string {
    const r = runGit(["rev-parse", "HEAD"], cwd);
    if (!r.ok) throw new Error("git rev-parse HEAD failed (not a git repo?)");
    return r.stdout;
  },
  dirtyPaths(cwd: string): string[] {
    const r = runGit(["status", "--porcelain"], cwd);
    if (!r.ok) return [];
    // porcelain v1: 2-char status + space + path; strip the 3-char prefix.
    return r.stdout
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter((p) => p.length > 0);
  },
};

/** Capture the baseline before an execution run. Throws if HEAD can't be read (unauditable cwd). */
export function captureBaseline(cwd: string, git: GitProbe = realGitProbe): ExecBaseline {
  return { headSha: git.headSha(cwd), preexistingDirty: git.dirtyPaths(cwd) };
}

/** Files the run is responsible for = dirty-after minus the baseline's pre-existing dirty. */
export function changedByRun(cwd: string, baseline: ExecBaseline, git: GitProbe = realGitProbe): string[] {
  const before = new Set(baseline.preexistingDirty);
  return git.dirtyPaths(cwd).filter((p) => !before.has(p));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/tests/claude-exec-baseline.test.js`
Expected: PASS — all 3 assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/execution/claude-exec-baseline.ts tests/claude-exec-baseline.test.ts
git commit -m "feat(execute): W3 — capture git baseline + attribute run's changed files"
```

---

## Task 3: Wire baseline + scope into the executor

**Files:**
- Modify: `src/execution/claude-task-executor.ts`
- Test: `tests/claude-task-executor.test.ts` (extend; existing cases must still pass)

- [ ] **Step 1: Write the failing tests**

Append to `tests/claude-task-executor.test.ts` — add the new imports at the top (merge with the existing import block) and a new `describe` block. The existing `ARMED` const is reused.

Add to the imports:

```typescript
import { type GitProbe } from "../src/execution/claude-exec-baseline.js";
```

Append this block at the end of the file:

```typescript
describe("runClaudeTask — W3 baseline + scope", () => {
  // A fake GitProbe: fixed head; first dirtyPaths() call = before, second = after.
  function fakeGit(snapshots: string[][]): GitProbe {
    let i = 0;
    return {
      headSha: () => "base-sha-001",
      dirtyPaths: () => snapshots[Math.min(i++, snapshots.length - 1)],
    };
  }

  it("success ⇒ returns the baseline sha and the files the run changed", async () => {
    const git = fakeGit([[], ["src/foo.ts"]]);
    const runner: ClaudeTaskRunner = async () => ({ ok: true, text: "Edited src/foo.ts." });
    const r = await runClaudeTask("add a null check to foo", ARMED, runner, git);
    assert.equal(r.ok, true);
    assert.equal(r.baselineSha, "base-sha-001");
    assert.deepEqual(r.filesChanged, ["src/foo.ts"]);
  });

  it("refuses (honest skip) when the baseline can't be captured — never spawns", async () => {
    let ran = false;
    const brokenGit: GitProbe = {
      headSha: () => { throw new Error("not a git repo"); },
      dirtyPaths: () => [],
    };
    const runner: ClaudeTaskRunner = async () => { ran = true; return { ok: true, text: "x" }; };
    const r = await runClaudeTask("add a null check to foo", ARMED, runner, brokenGit);
    assert.equal(r.ok, false);
    assert.match(r.detail, /baseline/i);
    assert.equal(ran, false, "must not spawn when it cannot anchor a baseline");
  });

  it("disarmed skip carries no baseline (gate runs before any git)", async () => {
    const r = await runClaudeTask("apply fix", { CLAUDE_CODE_OAUTH_TOKEN: "t" }, async () => ({ ok: true, text: "x" }));
    assert.equal(r.ok, false);
    assert.equal(r.baselineSha ?? null, null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build`
Expected: FAIL — `tsc` errors: `runClaudeTask` accepts 3 args not 4; `ClaudeTaskResult` has no `baselineSha`/`filesChanged`.

- [ ] **Step 3: Write the implementation**

Edit `src/execution/claude-task-executor.ts`.

(a) Add imports under the existing `import { gateAgentBuild } from "./agent-build-gate.js";`:

```typescript
import { assertCodeEditScope } from "./claude-exec-tool-scope.js";
import { captureBaseline, changedByRun, realGitProbe, type GitProbe } from "./claude-exec-baseline.js";
```

(b) Extend the result type — replace the existing `ClaudeTaskResult` interface with:

```typescript
export interface ClaudeTaskResult {
  ok: boolean;
  detail: string;
  /** W3 audit: the HEAD sha the run was anchored to (absent when skipped before baseline capture). */
  baselineSha?: string | null;
  /** W3 audit: working-tree files attributable to this run (empty array when the run wrote nothing). */
  filesChanged?: string[];
}
```

(c) Replace the `runClaudeTask` function body with the version that asserts scope, captures the baseline, and attributes changes. Replace the whole function (signature gains an injectable `git` param, default `realGitProbe`):

```typescript
export async function runClaudeTask(
  task: string,
  env: Env = process.env,
  runner: ClaudeTaskRunner = spawnClaudeTaskRunner,
  git: GitProbe = realGitProbe,
): Promise<ClaudeTaskResult> {
  const gate = claudeExecuteArmed(env);
  if (!gate.armed) return { ok: false, detail: `skipped — ${gate.reason}` };
  if (!task || !task.trim()) return { ok: false, detail: "skipped — empty task" };

  // SPEC-INTERROGATION GATE: HartOS must grill for specs before building an agent.
  const buildGate = gateAgentBuild(task);
  if (!buildGate.allowed) {
    return {
      ok: false,
      detail: `refused — ${buildGate.reason} Required specs: ${buildGate.questions.slice(0, 6).join(" · ") || "(see Factory)"}`,
    };
  }

  // W3: the tool scope handed to the hand must be code-edit-only — asserted, not assumed.
  const scope = assertCodeEditScope(EXEC_TOOLS);
  if (!scope.safe) {
    return { ok: false, detail: `refused — unsafe tool scope: ${scope.reason}`, baselineSha: null };
  }

  // W3: anchor the run to a git baseline. An unauditable run (no git) must NOT proceed.
  const cwd = process.cwd();
  let baseline;
  try {
    baseline = captureBaseline(cwd, git);
  } catch (e) {
    return { ok: false, detail: `skipped — cannot capture git baseline: ${e instanceof Error ? e.message : String(e)}`, baselineSha: null };
  }

  const model = env["HARTOS_CLAUDE_EXECUTE_MODEL"]?.trim() || DEFAULT_MODEL;
  const timeoutMs = Number(env["HARTOS_CLAUDE_EXECUTE_TIMEOUT_MS"]) || DEFAULT_TIMEOUT_MS;
  const token = (env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  try {
    const r = await runner(buildTaskPrompt(task), { model, token, timeoutMs, cwd });
    if (!r.ok) {
      return { ok: false, detail: `claude execution failed: ${r.text.replace(/\s+/g, " ").slice(0, 200)}`, baselineSha: baseline.headSha, filesChanged: [] };
    }
    const filesChanged = changedByRun(cwd, baseline, git);
    return {
      ok: true,
      detail: `claude applied (${filesChanged.length} file(s); review the working tree): ${r.text.replace(/\s+/g, " ").slice(0, 240)}`,
      baselineSha: baseline.headSha,
      filesChanged,
    };
  } catch (e) {
    return { ok: false, detail: `claude execution threw: ${e instanceof Error ? e.message : String(e)}`, baselineSha: baseline.headSha, filesChanged: [] };
  }
}
```

- [ ] **Step 4: Run the full executor suite to verify pass (old + new)**

Run: `npm run build && node --test dist/tests/claude-task-executor.test.js`
Expected: PASS — the 4 `claudeExecuteArmed` + 6 original `runClaudeTask` cases still green, plus the 3 new W3 cases. Note the original "armed + runner success" case asserts `/claude applied/`, which the new detail string still matches.

- [ ] **Step 5: Run the whole suite to confirm no regressions**

Run: `npm run build && node --test "dist/tests/*.test.js"`
Expected: PASS — full command-center suite green (the new modules add tests; no existing behaviour changed except the enriched, still-matching detail string).

- [ ] **Step 6: Commit**

```bash
git add src/execution/claude-task-executor.ts tests/claude-task-executor.test.ts
git commit -m "feat(execute): W3 — anchor claude.execute to a git baseline + audit changed files"
```

---

## Self-Review

**Spec coverage** (W3 = "bound the subprocess, capture git baseline, enforce code-edit-only tool scope, audit the run"):
- *capture git baseline* → Task 2 (`captureBaseline`) + Task 3 (refuse if uncapturable). ✅
- *enforce code-edit-only tool scope* → Task 1 (`assertCodeEditScope`, fail-closed) + Task 3 (asserted pre-spawn). ✅
- *audit the run* → Task 3 (`baselineSha` + `filesChanged` on the result). ✅ (Persisting via `agent-job.ts` is the noted follow-up.)
- *bound the subprocess* → already present pre-W3 (timeout `DEFAULT_TIMEOUT_MS`, `ANTHROPIC_API_KEY` stripped, `--allowedTools` no-Bash); W3 turns the no-Bash guarantee into an *asserted* invariant (Task 1). Not re-implemented (DRY/YAGNI). ✅

**Placeholder scan:** every code/test step contains complete, runnable content; no TBD/TODO/"handle edge cases". ✅

**Type consistency:** `GitProbe`/`ExecBaseline`/`captureBaseline`/`changedByRun` names match across Task 2 and Task 3; `ToolScopeVerdict`/`assertCodeEditScope`/`CODE_EDIT_TOOLS` match across Task 1 and Task 3; `runClaudeTask`'s new 4th param `git: GitProbe = realGitProbe` matches the test calls (`runClaudeTask(task, env, runner, git)`); `ClaudeTaskResult` fields `baselineSha`/`filesChanged` are referenced identically in impl and tests. ✅

**Doctrine guard:** no change to `executionAllowed`/`executeProposal`; the hard-capped path stays disabled. ✅
