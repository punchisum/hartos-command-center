/**
 * src/execution/execution-verification.ts — Phase 3 post-execution verification (PURE core).
 *
 * Today the approved-executor records "executed" when an adapter returns a delta. That proves the
 * adapter ran, NOT that the external world changed. This module closes that gap: given what the
 * mutation INTENDED and what a fresh re-read OBSERVED, it judges whether the change actually landed.
 *
 * Fails CLOSED: if the re-read could not be made (observed === null), the outcome is NOT landed —
 * an unverifiable write is treated as unproven, never silently "done". PURE: the caller does the
 * re-read; this never fetches and never throws.
 */

export type VerificationStrategy = "clickup-move" | "clickup-comment" | "refresh-sync";

export interface VerificationInput {
  strategy: VerificationStrategy;
  /** What the mutation intended. */
  expected: { toStatus?: string; marker?: string; staleBefore?: number };
  /** What a fresh re-read observed AFTER the write. null ⇒ the re-read itself failed. */
  observed: { status?: string; markers?: string[]; staleCount?: number } | null;
}

export interface VerificationResult {
  landed: boolean;
  detail: string;
}

export function verifyExecutionOutcome(input: VerificationInput): VerificationResult {
  // Fail closed: no fresh observation ⇒ the write is unproven, not "done".
  if (input.observed === null) {
    return { landed: false, detail: "post-write re-read failed — cannot confirm the change landed" };
  }
  switch (input.strategy) {
    case "clickup-move": {
      const landed = input.observed.status === input.expected.toStatus;
      return {
        landed,
        detail: landed
          ? `card reached "${input.expected.toStatus}"`
          : `card status is "${input.observed.status ?? "unknown"}", expected "${input.expected.toStatus ?? "?"}"`,
      };
    }
    case "clickup-comment": {
      const marker = input.expected.marker;
      const landed = Boolean(marker && (input.observed.markers ?? []).includes(marker));
      return {
        landed,
        detail: landed ? "idempotency-marked comment present" : "expected comment marker not found on re-read",
      };
    }
    case "refresh-sync": {
      const before = input.expected.staleBefore ?? 0;
      const after = input.observed.staleCount ?? before;
      const landed = after < before;
      return {
        landed,
        detail: landed ? `stale count fell ${before} → ${after}` : `stale count did not fall (${before} → ${after})`,
      };
    }
  }
}
