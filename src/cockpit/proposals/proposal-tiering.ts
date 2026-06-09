/**
 * src/cockpit/proposals/proposal-tiering.ts
 *
 * Mutation Tiering — the PURE payload-completeness check (3-levels-up master plan
 * §10 + §11). This module is assertion-only: it decides whether a proposal carries
 * the payload its declared tier requires, and names every missing field if not.
 *
 * It is NOT an execution path and it is NOT a second execution gate. The single
 * execution gate is `src/doctrine/execution-gate.ts` (`checkExecutionPrecondition`)
 * and stays the sole place execution is decided. This check is a PRECONDITION on the
 * proposal's SHAPE — "does a Tier-N proposal carry Tier-N's required fields?" — that a
 * caller would run BEFORE the execution gate is ever consulted. Like the execution
 * gate, it is pure (no I/O) and returns the same `{ allowed, denials[] }` shape so the
 * two read identically.
 *
 * Doctrine is never optional (master plan §10): EVERY tier requires the approval floor
 * (`requiredApproval`) and an audit-capable target. Higher tiers ADD payload; they
 * never weaken the floor. T4 (irreversible / cost-bearing) additionally demands an
 * explicit human gate EVERY time — never a session-blanket approval.
 */

import type {
  ActionProposal,
  ProposalTier,
  TypedActionProposal,
} from "./proposal-types.js";

/**
 * The required-payload keys per tier (master plan §10's table). Each entry lists the
 * field keys a proposal of that tier MUST carry. Ordered low→high risk; higher tiers
 * are supersets of the doctrine floor plus their own additions.
 *
 *   T0 internal low-risk cleanup → idempotency + audit (confirmed target) + approval floor
 *   T1 internal lifecycle        → full gate + audit + live status verification + approval floor
 *   T2 ops mirror                → read-before-write (beforeState) + audit + approval floor
 *   T3 external                  → before/after + idempotency + dry-run + approval + correction note
 *   T4 irreversible/cost-bearing → all of T3 + an explicit human gate, every time
 *
 * Keys are field names on the proposal (canonical `ActionProposal`), except the
 * doctrine pseudo-keys `requiredApproval` (approval floor, always present) and
 * `explicitHumanGate` (T4-only — see `isExplicitHumanGate`).
 */
export const REQUIRED_PAYLOAD_BY_TIER: Readonly<Record<ProposalTier, readonly string[]>> = {
  // T0 — archive a rejected proposal: a confirmed target + an idempotency key (so a
  // re-run is a no-op) + the approval floor. Lightest tier; still typed + audited.
  T0: ["tier", "targetId", "idempotencyKey", "requiredApproval"],
  // T1 — approve_for_execution: the full gate's payload + a dry-run + the approval
  // floor. "Live status verification" rides the dry-run (the read of current state).
  T1: ["tier", "targetId", "idempotencyKey", "dryRunResult", "requiredApproval"],
  // T2 — mark an ops item reviewed: read-before-write (a beforeState snapshot) + a
  // confirmed target + the approval floor.
  T2: ["tier", "targetId", "beforeState", "requiredApproval"],
  // T3 — external (ClickUp comment / move): the full payload — before AND after +
  // idempotency + dry-run + approval + a rollback/correction note.
  T3: [
    "tier",
    "targetId",
    "beforeState",
    "afterState",
    "idempotencyKey",
    "dryRunResult",
    "requiredApproval",
    "rollbackOrCorrectionNote",
  ],
  // T4 — irreversible / cost-bearing (deploy infra, create resources): everything T3
  // requires PLUS an explicit human gate, asserted every single time.
  T4: [
    "tier",
    "targetId",
    "beforeState",
    "afterState",
    "idempotencyKey",
    "dryRunResult",
    "requiredApproval",
    "rollbackOrCorrectionNote",
    "explicitHumanGate",
  ],
};

/** Result shape — mirrors `PreconditionResult` from the single execution gate. */
export interface TierPayloadResult {
  allowed: boolean;
  /** Empty iff allowed. Every missing required field is named (fail-closed). */
  denials: string[];
}

/** True when a value counts as "present" for payload purposes. */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  // A before/after state object is only "present" when it actually carries data.
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

/**
 * The T4-only doctrine pseudo-field. The approval floor is `requiredApproval: "Hart"`
 * on every proposal; T4 additionally demands an EXPLICIT per-action human gate (never a
 * session-blanket). A proposal signals it by carrying `requiredApproval === "Hart"`
 * together with a dry-run (proof a human was shown what WOULD happen). This stays pure
 * — no env read, no session lookup — so the assertion is deterministic and testable.
 */
function isExplicitHumanGate(p: Partial<ActionProposal>): boolean {
  return p.requiredApproval === "Hart" && isPresent(p.dryRunResult);
}

/** Whether a single required field-key is satisfied on the proposal. */
function fieldSatisfied(p: Partial<ActionProposal>, key: string): boolean {
  switch (key) {
    case "requiredApproval":
      // The approval floor — present on every proposal, never optional.
      return p.requiredApproval === "Hart";
    case "explicitHumanGate":
      return isExplicitHumanGate(p);
    case "tier":
      return isPresent(p.tier);
    case "targetId":
      return isPresent(p.targetId);
    case "targetName":
      return isPresent(p.targetName);
    case "beforeState":
      return isPresent(p.beforeState);
    case "afterState":
      return isPresent(p.afterState);
    case "idempotencyKey":
      return isPresent(p.idempotencyKey);
    case "dryRunResult":
      return isPresent(p.dryRunResult);
    case "rollbackOrCorrectionNote":
      return isPresent(p.rollbackOrCorrectionNote);
    default:
      return false;
  }
}

/** Human-readable reason a field is missing, for the denials list. */
function missingReason(tier: ProposalTier, key: string): string {
  switch (key) {
    case "requiredApproval":
      return `tier ${tier} requires the approval floor (requiredApproval must be "Hart")`;
    case "explicitHumanGate":
      return `tier ${tier} requires an explicit human gate every time (requiredApproval "Hart" + a dry-run shown to a human); a session-blanket approval is not enough`;
    case "tier":
      return `proposal is missing its tier`;
    case "targetId":
      return `tier ${tier} requires a confirmed target (targetId) — no "apply to all"`;
    case "beforeState":
      return `tier ${tier} requires a read-before-write snapshot (beforeState)`;
    case "afterState":
      return `tier ${tier} requires an intended afterState`;
    case "idempotencyKey":
      return `tier ${tier} requires an idempotencyKey (build it with makeIdempotencyKey)`;
    case "dryRunResult":
      return `tier ${tier} requires a dry-run result (dryRunResult)`;
    case "rollbackOrCorrectionNote":
      return `tier ${tier} requires a rollback/correction note (rollbackOrCorrectionNote)`;
    default:
      return `tier ${tier} requires "${key}"`;
  }
}

/**
 * PURE. Assert a proposal carries the payload its declared tier requires.
 *
 * Returns `{ allowed: true, denials: [] }` ONLY when every required field for the
 * proposal's tier is present; otherwise lists every missing field by name. Fail-closed:
 * a proposal with NO tier is denied (a typed mutation must declare its tier).
 *
 * This NEVER executes anything and NEVER substitutes for the execution gate — it is the
 * shape precondition a caller runs first. No I/O.
 */
export function assertTierPayloadComplete(
  proposal: Partial<TypedActionProposal>
): TierPayloadResult {
  const denials: string[] = [];

  const tier = proposal.tier;
  if (!isPresent(tier)) {
    return {
      allowed: false,
      denials: ['proposal has no tier; a typed mutation must declare its tier (T0..T4)'],
    };
  }

  const required = REQUIRED_PAYLOAD_BY_TIER[tier as ProposalTier];
  for (const key of required) {
    if (!fieldSatisfied(proposal, key)) {
      denials.push(missingReason(tier as ProposalTier, key));
    }
  }

  return { allowed: denials.length === 0, denials };
}
