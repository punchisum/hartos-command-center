/**
 * src/learning/council-calibration-aggregate.ts
 *
 * P8 — council-calibration slice, Unit 1.
 *
 * PURE aggregator: groups council-run records by confidence band, counts approved
 * vs rejected (pending excluded), and returns the approval rate per band.
 * A band with zero decided runs reports the neutral rate 0.5 so the decide() unit
 * always has a valid number and can no-op it (delta from 0.5 to 0.5 = 0).
 *
 * PURE. No IO. No network. No mutation. Never throws.
 */

import { CONFIDENCE_BANDS } from "../council/council-types.js";
import type { Confidence } from "../council/council-types.js";
import type { CouncilDecision } from "../council/council-memory.js";

export interface BandStat {
  band: Confidence;
  decided: number;      // approved + rejected (pending excluded)
  approved: number;
  approvalRate: number; // approved / decided, or 0.5 if decided === 0
}

export interface CalibrationAggregate {
  byBand: Record<Confidence, BandStat>;
  totalDecided: number;
}

/** Input: one record per council run, already mapped from a persisted proposal row. */
export interface CouncilRunRecord {
  confidence: Confidence;    // the RAW stated band from the payload
  decision: CouncilDecision; // approved | rejected | pending
}

/** PURE — group decided runs by band, compute approval rate. Pending excluded. Never throws. */
export function aggregateCalibration(records: CouncilRunRecord[]): CalibrationAggregate {
  // Seed all three bands with zeroed accumulators.
  const acc: Record<Confidence, { approved: number; decided: number }> = {
    low: { approved: 0, decided: 0 },
    medium: { approved: 0, decided: 0 },
    high: { approved: 0, decided: 0 },
  };

  for (const r of records) {
    // Skip pending — undecided is not signal.
    if (r.decision === "pending") continue;
    acc[r.confidence].decided += 1;
    if (r.decision === "approved") {
      acc[r.confidence].approved += 1;
    }
  }

  let totalDecided = 0;
  const byBand = {} as Record<Confidence, BandStat>;

  for (const band of CONFIDENCE_BANDS) {
    const { approved, decided } = acc[band];
    totalDecided += decided;
    byBand[band] = {
      band,
      decided,
      approved,
      // Neutral 0.5 when no decided runs — decide() will no-op it (delta = 0).
      approvalRate: decided === 0 ? 0.5 : approved / decided,
    };
  }

  return { byBand, totalDecided };
}
