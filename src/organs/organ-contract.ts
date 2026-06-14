/**
 * src/organs/organ-contract.ts — SP-Organs shared contract.
 *
 * PURE (no node/net/clock imports) so the Worker can import the types + deriver. Spec:
 * docs/superpowers/specs/2026-06-14-sp-organs-design.md. Doctrine: UI = Reflect(SOT); status is
 * DERIVED from evidence, never stored as truth.
 */

export type OrganStatus = "REGISTERED" | "PARTIAL" | "LIVE" | "FAILED" | "RETIRED";
export type OrganTrigger = "scheduled" | "on_demand" | "worker";

/** The single result every organ adapter returns from one run. */
export interface OrganRunResult {
  ok: boolean;
  /** A SOT-readable handle the cockpit can read back (row id / vault path); null if none. */
  outputRef: string | null;
  summary: string;
  detail?: Record<string, unknown>;
}

/** Evidence the deriver reads (assembled from organ_runs + heartbeat freshness + readback probe). */
export interface OrganEvidence {
  /** Age of the freshest liveness signal in seconds; null = no heartbeat at all. */
  heartbeatAgeSec: number | null;
  stalenessThresholdSec: number;
  lastRun: { ok: boolean; trigger: OrganTrigger; disarmed: boolean; outputRef: string | null } | null;
  /** Can the cockpit detail route read the last output back from SOT? */
  readbackOk: boolean;
  lifecycleRetired: boolean;
}
