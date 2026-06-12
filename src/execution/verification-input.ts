/**
 * src/execution/verification-input.ts — Phase 3 arming: the bridge from a dispatched
 * MutationCommand to the post-execution verifier. Given the command and a FRESH observed re-read
 * (the caller performs the adapter-specific read), it picks the verification strategy and the
 * expected end-state. Returns null for adapters that have no external state to re-verify yet
 * (internal queue mutations) — those are added as their re-read paths are wired. PURE.
 */

import type { MutationCommand } from "./execution-dispatch.js";
import type { VerificationInput } from "./execution-verification.js";

export function verificationInputForCommand(
  command: MutationCommand,
  observed: VerificationInput["observed"],
): VerificationInput | null {
  switch (command.adapterId) {
    case "clickup-move-status":
      // The card must have reached the target status — confirmed by a fresh re-read.
      return { strategy: "clickup-move", expected: { toStatus: command.target.toStatus }, observed };
    default:
      // comment / refresh-sync / internal-queue adapters: added as each adapter's fresh-re-read
      // path is wired in (their expected state isn't a single card-status field).
      return null;
  }
}
