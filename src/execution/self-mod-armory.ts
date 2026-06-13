/**
 * src/execution/self-mod-armory.ts — Phase 6 (Amendment §6): the circuit breaker + rate cap for
 * auto-apply. A failed post-deploy trips the disarm marker (no more auto-applies until Hart re-arms);
 * a rate cap (1/hour) bounds a misfiring loop. PURE over an injectable store; the real store (a marker
 * file / DB row on the daemon) is a thin adapter. Disarm takes precedence over the rate check.
 */
export const RATE_LIMIT_MS = 60 * 60 * 1000; // ≤ 1 auto-deploy per hour

export interface ArmoryStore {
  /** Has the circuit breaker tripped (a prior failed deploy disarmed self-mod)? */
  isDisarmed(): boolean;
  /** Trip the breaker — no more auto-applies until cleared. */
  setDisarmed(reason: string): void;
  /** Hart re-arms — clear the breaker. */
  clearDisarmed(): void;
  /** Epoch ms of the last auto-deploy, or null if none. */
  lastAutoDeployAt(): number | null;
  /** Record an auto-deploy at the given epoch ms (for the rate cap). */
  recordAutoDeploy(at: number): void;
}

export interface AutoApplyVerdict {
  ok: boolean;
  reason: string;
}

/** May an auto-apply proceed at `now`? Blocked if the breaker is tripped or within the rate window. */
export function canAutoApply(now: number, store: ArmoryStore): AutoApplyVerdict {
  if (store.isDisarmed()) {
    return { ok: false, reason: "self-mod disarmed — the circuit breaker tripped (a prior auto-deploy failed); Hart must re-arm" };
  }
  const last = store.lastAutoDeployAt();
  if (last !== null && now - last < RATE_LIMIT_MS) {
    const minsAgo = Math.round((now - last) / 60000);
    return { ok: false, reason: `rate-limited — last auto-deploy ${minsAgo}min ago (cap 1/hour)` };
  }
  return { ok: true, reason: "clear to auto-apply" };
}
