/**
 * src/wolverine/detectors/self-mod-drift.ts
 *
 * P6 §6 — self-mod guardrail drift monitor (watch the watchmen).
 *
 * Calls the live self-mod guards and asserts they still refuse to let self-mod edit its own
 * guardrails or arm without all conditions met. If a future refactor weakens a guard — e.g.
 * removes a path from SELF_PROTECTED_PREFIXES, or makes isSelfModArmed return true on missing
 * inputs — this detector fires a critical finding. It is the invariant that the invariants hold.
 *
 * Wolverine detectors are pure: no I/O, no env access, no mutation. The `inputs` parameter is
 * accepted for registry compatibility but is intentionally unused — this detector inspects the
 * code's own static guards, not external runtime state.
 */

import type { WolverineFinding, WolverineInputs } from "../wolverine-types.js";
import { isInSelfModScope } from "../../execution/self-mod-scope-guard.js";
import { isSelfModArmed } from "../../doctrine/amendment-gate.js";

export const SELF_MOD_DRIFT_DETECTOR = "self-mod-drift";

/**
 * The complete list of paths that MUST stay out of self-mod scope. If isInSelfModScope ever
 * returns allowed:true for any of these, the fence has drifted and self-mod could weaken its
 * own restraints in the same run's post-verify step.
 */
const GUARDRAIL_PATHS = [
  "src/doctrine/doctrine.ts",
  "src/doctrine/amendment-gate.ts",
  "src/llm/redaction.ts",
  "src/execution/self-mod-scope-guard.ts",
  "src/execution/self-mod-pre-verify.ts",
  "src/execution/self-mod-post-verify.ts",
  "src/execution/self-mod-rollback.ts",
  "src/execution/execution-verification.ts",
];

export function detectSelfModDrift(inputs: WolverineInputs): WolverineFinding[] {
  // inputs is intentionally unused — see module header.
  void inputs;

  const findings: WolverineFinding[] = [];

  // ── Check 1: scope guard must deny every guardrail path ──────────────────────────────────────
  const driftedPaths = GUARDRAIL_PATHS.filter((p) => isInSelfModScope(p).allowed === true);

  if (driftedPaths.length > 0) {
    findings.push({
      id: "self-mod-drift:scope-guard-weakened",
      category: "doctrine_drift",
      severity: "critical",
      title: `Self-mod scope guard now ALLOWS editing ${driftedPaths.length} guardrail path(s)`,
      evidence:
        `isInSelfModScope returned allowed:true for: ${driftedPaths.join(", ")}. ` +
        `These paths must be denied — a self-mod that can edit its own fence or verifier ` +
        `can clear an (now-unguarded) change in the same run's post-verify step.`,
      ownerAgent: "HartOS self-mod spine",
      recommendedFix:
        "Restore the missing prefix(es) to SELF_PROTECTED_PREFIXES in " +
        "src/execution/self-mod-scope-guard.ts so isInSelfModScope denies every guardrail path.",
      blastRadius:
        "Any autonomous self-mod run that targets these paths is now ungated — it could " +
        "edit the fence, the verifiers, or the amendment-gate without denial.",
      rollbackPath:
        "Re-add the removed prefix(es) to SELF_PROTECTED_PREFIXES and rebuild. No data changed.",
      approvalRequired: true,
      confidence: "high",
      freshness: "live guard call, as of run",
      source: SELF_MOD_DRIFT_DETECTOR,
    });
  }

  // ── Check 2a: amendment-gate must be fail-closed (all conditions false ⇒ not armed) ─────────
  if (isSelfModArmed({ amendmentApproved: false, classFlagArmed: false, killSwitchOn: false })) {
    findings.push({
      id: "self-mod-drift:gate-armed-no-conditions",
      category: "doctrine_drift",
      severity: "critical",
      title: "Amendment-gate armed with no conditions met",
      evidence:
        "isSelfModArmed({ amendmentApproved: false, classFlagArmed: false, killSwitchOn: false }) " +
        "returned true. The gate must be fail-closed: all three conditions false ⇒ not armed. " +
        "The gate logic has drifted from the fail-closed invariant.",
      ownerAgent: "HartOS amendment-gate",
      recommendedFix:
        "Restore isSelfModArmed in src/doctrine/amendment-gate.ts to require " +
        "amendmentApproved && classFlagArmed && !killSwitchOn.",
      blastRadius:
        "Self-mod could run without any approval or class-flag opt-in — every autonomous " +
        "self-mod path is ungated.",
      rollbackPath: "Restore the gate logic and rebuild. No data changed.",
      approvalRequired: true,
      confidence: "high",
      freshness: "live gate call, as of run",
      source: SELF_MOD_DRIFT_DETECTOR,
    });
  }

  // ── Check 2b: kill-switch must dominate (all conditions true but kill-switch on ⇒ not armed) ─
  if (isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: true })) {
    findings.push({
      id: "self-mod-drift:kill-switch-no-longer-dominates",
      category: "doctrine_drift",
      severity: "critical",
      title: "Kill-switch no longer dominates the amendment-gate",
      evidence:
        "isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: true }) " +
        "returned true. The kill-switch (killSwitchOn: true) must always veto, even when both " +
        "approval flags are set. The gate logic has drifted from the kill-switch-dominates invariant.",
      ownerAgent: "HartOS amendment-gate",
      recommendedFix:
        "Restore !killSwitchOn as a required conjunct in isSelfModArmed so the kill-switch " +
        "always dominates regardless of the approval flags.",
      blastRadius:
        "The global kill-switch can no longer safely halt all autonomous self-mod — any " +
        "fully-approved run would proceed even with the kill-switch engaged.",
      rollbackPath: "Restore the gate logic and rebuild. No data changed.",
      approvalRequired: true,
      confidence: "high",
      freshness: "live gate call, as of run",
      source: SELF_MOD_DRIFT_DETECTOR,
    });
  }

  return findings;
}
