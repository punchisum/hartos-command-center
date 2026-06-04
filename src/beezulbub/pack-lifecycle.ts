/**
 * src/beezulbub/pack-lifecycle.ts
 *
 * Pack and capability lifecycle states and transition rules.
 * Phase 11D: Governance layer.
 */

import type { PackStatus } from "./pack-types.js";

// ─── Pack lifecycle states ────────────────────────────────────────────────────

export const PACK_STATUS_ORDER: PackStatus[] = [
  "candidate",
  "planned",
  "skeleton",
  "implementation_draft",
  "verified",
  "available",
];

export const TERMINAL_PACK_STATUSES = new Set<PackStatus>([
  "deprecated",
  "rejected",
  "blocked",
]);

/** States that can be promoted to `verified` */
export const PROMOTABLE_TO_VERIFIED = new Set<PackStatus>([
  "implementation_draft",
]);

/** States that can be promoted to `available` */
export const PROMOTABLE_TO_AVAILABLE = new Set<PackStatus>([
  "verified",
]);

export function isValidPackStatus(status: string): status is PackStatus {
  const all: string[] = [
    "candidate", "planned", "skeleton", "reference_only",
    "implementation_draft", "verified", "available",
    "deprecated", "rejected", "blocked",
  ];
  return all.includes(status);
}

export function isUsablePackStatus(status: PackStatus): boolean {
  return status === "verified" || status === "available";
}

export function canPromoteTo(
  currentStatus: PackStatus,
  targetStatus: "verified" | "available"
): { allowed: boolean; reason: string } {
  if (targetStatus === "verified") {
    if (!PROMOTABLE_TO_VERIFIED.has(currentStatus)) {
      return {
        allowed: false,
        reason: `Pack must be in implementation_draft to promote to verified. Current: ${currentStatus}`,
      };
    }
    return { allowed: true, reason: "Pack is ready for verification" };
  }

  if (targetStatus === "available") {
    if (!PROMOTABLE_TO_AVAILABLE.has(currentStatus)) {
      return {
        allowed: false,
        reason: `Pack must be verified before becoming available. Current: ${currentStatus}`,
      };
    }
    return { allowed: true, reason: "Pack is verified and ready for availability" };
  }

  return { allowed: false, reason: `Unknown target status: ${targetStatus}` };
}

// ─── Capability lifecycle states ──────────────────────────────────────────────

export type CapabilityStatus =
  | "missing"
  | "scouted"
  | "devour_recommended"
  | "pack_skeleton_created"
  | "implementation_pending"
  | "implementation_draft"
  | "verified"
  | "available"
  | "in_use"
  | "retired"
  | "rejected";

export function isValidCapabilityStatus(status: string): status is CapabilityStatus {
  const all: CapabilityStatus[] = [
    "missing", "scouted", "devour_recommended", "pack_skeleton_created",
    "implementation_pending", "implementation_draft", "verified", "available",
    "in_use", "retired", "rejected",
  ];
  return all.includes(status as CapabilityStatus);
}

export function packStatusToCapabilityStatus(packStatus: PackStatus): CapabilityStatus {
  switch (packStatus) {
    case "skeleton": return "pack_skeleton_created";
    case "implementation_draft": return "implementation_draft";
    case "verified": return "verified";
    case "available": return "available";
    case "deprecated": return "retired";
    case "rejected": return "rejected";
    default: return "pack_skeleton_created";
  }
}
