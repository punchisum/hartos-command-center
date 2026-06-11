/**
 * src/doctrine/autoheal-invariant.ts — the PURE autoheal invariant (single source of truth).
 *
 * "ONE GATE, NOT TWO." Two things reason about autonomy: the DECISION ENGINE (the brain that
 * classifies a request's autonomy tier) and the AUTOHEAL-GATE (the hands that actually auto-execute
 * a fix in the daily pulse). They must agree, exactly, on which actions may ever run UNATTENDED:
 * internal + reversible only. This module is the dependency-free statement of that invariant — the
 * eligible adapter ids + the class flag + the human description — so BOTH sides import one
 * definition. A conformance test (autoheal-invariant.test.ts) fails the build if the gate and the
 * brain ever drift apart.
 *
 * Pure; no I/O; no execution adapters; safe to import into the read-only Worker (the decision
 * engine, which the Worker imports, consumes this — so it must stay node-free). `import type` keeps
 * the MutationAdapterId reference compile-time only.
 */

import type { MutationAdapterId } from "../execution/execution-dispatch.js";

/** The single class flag that authorizes autonomous APPROVAL for internal queue hygiene (default OFF). */
export const AUTOHEAL_CLASS_FLAG = "ALLOW_AUTOHEAL_PROPOSAL_HYGIENE" as const;

/**
 * The ONLY adapters that may ever auto-execute unattended. Each is internal + reversible (HartOS's
 * own Supabase proposal queue), so autonomous hands can never reach an external system. This list
 * MUST equal the union of adapter ids across `AUTOHEAL_CLASSES` in autoheal-gate.ts — the drift
 * guard test enforces it. `satisfies` proves each id is a real MutationAdapterId.
 */
export const AUTOHEAL_ELIGIBLE_ADAPTER_IDS = [
  "reject-drafts",
  "archive-rejected",
  "refresh-sync",
] as const satisfies readonly MutationAdapterId[];

export type AutohealEligibleAdapterId = (typeof AUTOHEAL_ELIGIBLE_ADAPTER_IDS)[number];

/** The binding doctrine that bounds autonomous execution. Surfaced in the cockpit for honesty. */
export const AUTOHEAL_INVARIANT =
  "Auto-execution is internal + reversible only — HartOS's own Supabase queue. No external adapter " +
  "(ClickUp / Telegram / deploy) is, or may ever be, an autoheal class. Triple-gated: the class flag " +
  "(ALLOW_AUTOHEAL_PROPOSAL_HYGIENE) AND each adapter's ALLOW_EXEC_* AND the global kill-switch.";

/** True when an adapter id is autoheal-eligible (may auto-execute unattended). Pure. */
export function isAutohealEligible(adapterId: string): adapterId is AutohealEligibleAdapterId {
  return (AUTOHEAL_ELIGIBLE_ADAPTER_IDS as readonly string[]).includes(adapterId);
}
