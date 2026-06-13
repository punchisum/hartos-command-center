/**
 * src/execution/self-mod-classifier.ts — Phase 6 (Amendment §6): route a self-mod change to its tier.
 *
 * Tier 1 (auto-apply) is permitted ONLY for the fix/recalibrate classes AND only within the blast-radius
 * cap. extend is always Tier 2 (propose-only); anything over the cap — even a fix — escalates to Tier 2;
 * an unrecognised class fails closed to Tier 2. PURE — the caller supplies the class + change size.
 */
export const SELF_MOD_MAX_FILES = 5;
export const SELF_MOD_MAX_LINES = 150;

export type SelfModClass = "fix" | "recalibrate" | "extend";
export type SelfModTier = "auto-apply" | "propose-only";

export interface TierVerdict {
  tier: SelfModTier;
  reason: string;
}

/** Route a self-mod change to a tier. Only fix/recalibrate within the cap may auto-apply; all else is propose-only. */
export function classifyTier(input: { selfModClass: SelfModClass; fileCount: number; changedLines: number }): TierVerdict {
  const { selfModClass, fileCount, changedLines } = input;
  if (selfModClass !== "fix" && selfModClass !== "recalibrate") {
    // extend, or any unrecognised class → fail-closed to propose-only.
    return { tier: "propose-only", reason: `class "${selfModClass}" is propose-only (only fix/recalibrate may auto-apply)` };
  }
  if (fileCount > SELF_MOD_MAX_FILES) {
    return { tier: "propose-only", reason: `${fileCount} files exceeds the ${SELF_MOD_MAX_FILES}-file cap — escalated to propose-only` };
  }
  if (changedLines > SELF_MOD_MAX_LINES) {
    return { tier: "propose-only", reason: `${changedLines} changed lines exceeds the ${SELF_MOD_MAX_LINES}-line cap — escalated to propose-only` };
  }
  return { tier: "auto-apply", reason: `${selfModClass} within cap (${fileCount} files / ${changedLines} lines) — auto-apply` };
}
