/**
 * src/execution/self-mod-executor.ts — Phase 6: orchestrate one autonomous self-modification through
 * the full fail-closed gauntlet. STILL DISARMED — `isArmed` is false until a Constitutional Amendment
 * §6 + the class flag are approved, so by default this is a pure no-op skip.
 *
 * Order (each stage can abort): amendment-gate (armed?) → pre-verify (clean baseline) → run the W3
 * hand → compute the changed set → if the hand failed, ROLL BACK → else run the test suite (the real
 * "doctrine holds + tests pass" check) + post-verify (in-scope + no secret) → KEEP only if BOTH pass,
 * else ROLL BACK. Every external effect is an injectable port so the orchestration is fully testable
 * without git/claude/a real test run; the default ports (real wiring) are a later increment.
 */
import type { ExecBaseline } from "./claude-exec-baseline.js";
import type { PreVerifyResult } from "./self-mod-pre-verify.js";
import type { PostVerifyResult } from "./self-mod-post-verify.js";
import type { RollbackResult } from "./self-mod-rollback.js";

export interface SelfModPorts {
  /** Amendment §6 approved AND class flag armed AND kill-switch off. */
  isArmed(): boolean;
  /** Capture a clean baseline anchor; refuse a dirty/non-git tree. */
  preVerify(): PreVerifyResult;
  /** Run the W3 code-editing hand on the approved task. */
  runHand(): Promise<{ ok: boolean; detail: string }>;
  /** The files the run touched, attributed against the baseline. */
  changedFiles(baseline: ExecBaseline): string[];
  /** The run's diff text (for the secret-leak scan). */
  diffText(baseline: ExecBaseline): string;
  /** Run the test suite as a fresh subprocess — the real "doctrine holds + tests pass" check. */
  runTests(): { ok: boolean; detail: string };
  /** In-scope paths + no secret leak. */
  postVerify(changedFiles: string[], diffText: string): PostVerifyResult;
  /** Restore the working tree to the baseline. */
  rollback(baseline: ExecBaseline, changedFiles: string[]): RollbackResult;
}

export type SelfModOutcome = "skipped" | "kept" | "rolled-back" | "rollback-failed";

export interface SelfModRunResult {
  outcome: SelfModOutcome;
  stage: "amendment-gate" | "pre-verify" | "hand" | "verify" | "verified";
  reason: string;
  changedFiles: string[];
  errors: string[];
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Roll back (best-effort) and build the result. A THROWING rollback port still yields rollback-failed
 * with the error surfaced — never an escaped exception. The orchestration must not trust any port not
 * to throw, because a failed self-mod left un-rolled-back is worse than a loud failure.
 */
function rollbackAnd(
  stage: "hand" | "verify",
  reason: string,
  baseline: ExecBaseline,
  changed: string[],
  ports: SelfModPorts,
): SelfModRunResult {
  let rb: RollbackResult;
  try {
    rb = ports.rollback(baseline, changed);
  } catch (re) {
    return { outcome: "rollback-failed", stage, reason, changedFiles: changed, errors: [`rollback threw: ${msg(re)}`] };
  }
  return {
    outcome: rb.ok ? "rolled-back" : "rollback-failed",
    stage,
    reason,
    changedFiles: changed,
    errors: rb.ok ? [] : rb.errors,
  };
}

/** Run one self-mod through the gauntlet. Disarmed by default ⇒ a skip. Once the baseline is taken,
 *  ANY port throw triggers a best-effort rollback and a verdict — an exception never escapes. */
export async function executeSelfMod(ports: SelfModPorts): Promise<SelfModRunResult> {
  if (!ports.isArmed()) {
    return { outcome: "skipped", stage: "amendment-gate", reason: "self-mod not armed (amendment / class flag / kill-switch)", changedFiles: [], errors: [] };
  }

  // pre-verify: a dirty/non-git tree (or a throwing probe) refuses BEFORE the tree is ever touched.
  let pre: PreVerifyResult;
  try {
    pre = ports.preVerify();
  } catch (e) {
    return { outcome: "skipped", stage: "pre-verify", reason: `pre-verify threw: ${msg(e)}`, changedFiles: [], errors: [] };
  }
  if (!pre.ok || !pre.baseline) {
    return { outcome: "skipped", stage: "pre-verify", reason: pre.reason, changedFiles: [], errors: [] };
  }
  const baseline = pre.baseline;

  // From here the working tree may be edited → any throw MUST roll back, never escape.
  let changed: string[] = [];
  try {
    const hand = await ports.runHand();
    // Authoritative changed set (captures partial edits even if the hand reported failure).
    changed = ports.changedFiles(baseline);

    if (!hand.ok) {
      return rollbackAnd("hand", `hand failed: ${hand.detail}`, baseline, changed, ports);
    }

    // Evaluate BOTH gates before deciding, so the reason reports every failure.
    const tests = ports.runTests();
    const post = ports.postVerify(changed, ports.diffText(baseline));

    if (tests.ok && post.ok) {
      return { outcome: "kept", stage: "verified", reason: "self-mod verified (tests pass, in scope, no secret leak)", changedFiles: changed, errors: [] };
    }

    const reasons: string[] = [];
    if (!tests.ok) reasons.push(`tests failed: ${tests.detail}`);
    if (!post.ok) reasons.push(`post-verify: ${post.violations.map((v) => `${v.kind} ${v.detail}`).join("; ")}`);
    return rollbackAnd("verify", reasons.join(" | "), baseline, changed, ports);
  } catch (e) {
    // A port threw after the baseline — the tree may hold partial edits. If we never captured the
    // changed set, best-effort recompute it so rollback knows what to revert; then roll back + report.
    if (changed.length === 0) {
      try { changed = ports.changedFiles(baseline); } catch { /* keep [] — rollback does what it can */ }
    }
    return rollbackAnd("verify", `port threw: ${msg(e)}`, baseline, changed, ports);
  }
}
