/**
 * src/doctrine/amendment-gate.ts — Phase 6: the pure check that decides whether autonomous
 * self-modification is ARMED. It is the opposite of the execution-disabled doctrine default: it
 * may only return true behind a formally approved Constitutional Amendment §6 AND a distinct class
 * flag, AND only while the global kill switch is off. Fail-closed: anything missing ⇒ not armed.
 * PURE: no I/O, no env (the caller reads the flags).
 */

export interface AmendmentGateInput {
  /** The Constitutional Amendment §6 (which replaces the execution-disabled invariant) is approved. */
  amendmentApproved: boolean;
  /** The distinct self-mod class flag is armed (second, separate opt-in). */
  classFlagArmed: boolean;
  /** HARTOS_EXECUTION_KILL_SWITCH is on — disables every autonomous path, including this. */
  killSwitchOn: boolean;
}

export function isSelfModArmed(input: AmendmentGateInput): boolean {
  return input.amendmentApproved && input.classFlagArmed && !input.killSwitchOn;
}
