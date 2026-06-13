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

function afterRollback(
  stage: "hand" | "verify",
  reason: string,
  changed: string[],
  rb: RollbackResult,
): SelfModRunResult {
  return {
    outcome: rb.ok ? "rolled-back" : "rollback-failed",
    stage,
    reason,
    changedFiles: changed,
    errors: rb.ok ? [] : rb.errors,
  };
}

/** Run one self-mod through the gauntlet. Disarmed by default ⇒ a skip. Decides on port verdicts only. */
export async function executeSelfMod(ports: SelfModPorts): Promise<SelfModRunResult> {
  if (!ports.isArmed()) {
    return { outcome: "skipped", stage: "amendment-gate", reason: "self-mod not armed (amendment / class flag / kill-switch)", changedFiles: [], errors: [] };
  }

  const pre = ports.preVerify();
  if (!pre.ok || !pre.baseline) {
    return { outcome: "skipped", stage: "pre-verify", reason: pre.reason, changedFiles: [], errors: [] };
  }
  const baseline = pre.baseline;

  const hand = await ports.runHand();
  // Authoritative changed set (captures partial edits even if the hand reported failure).
  const changed = ports.changedFiles(baseline);

  if (!hand.ok) {
    return afterRollback("hand", `hand failed: ${hand.detail}`, changed, ports.rollback(baseline, changed));
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
  return afterRollback("verify", reasons.join(" | "), changed, ports.rollback(baseline, changed));
}
