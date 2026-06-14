// src/learning/council-calibration-aggregate.ts
/**
 * P8 — pure aggregator. Group DECIDED council runs by their raw confidence band and
 * compute the per-band approval rate. Pending runs are excluded (undecided is not
 * signal). PURE — never throws. A band with zero decided runs reports the neutral
 * rate 0.5 so the decide step no-ops it.
 */
import type { Confidence } from "../council/council-types.js";
import { isConfidence } from "../council/council-types.js";
import type { CouncilDecision } from "../council/council-memory.js";

/** One council run, reduced to the two fields calibration needs. */
export interface CouncilRunRecord {
  confidence: Confidence;
  decision: CouncilDecision;
}

export interface BandStat {
  band: Confidence;
  decided: number; // approved + rejected (pending excluded)
  approved: number;
  approvalRate: number; // approved/decided, or 0.5 when decided === 0
}

export interface CalibrationAggregate {
  byBand: Record<Confidence, BandStat>;
  totalDecided: number;
}

const BANDS: Confidence[] = ["low", "medium", "high"];

/** PURE — never throws. Malformed records are skipped. */
export function aggregateCalibration(records: CouncilRunRecord[]): CalibrationAggregate {
  const counts: Record<Confidence, { decided: number; approved: number }> = {
    low: { decided: 0, approved: 0 },
    medium: { decided: 0, approved: 0 },
    high: { decided: 0, approved: 0 },
  };

  const list = Array.isArray(records) ? records : [];
  for (const rec of list) {
    if (!rec || typeof rec !== "object") continue;
    const band = (rec as CouncilRunRecord).confidence;
    const decision = (rec as CouncilRunRecord).decision;
    if (!isConfidence(band)) continue;
    if (decision === "approved") {
      counts[band].decided += 1;
      counts[band].approved += 1;
    } else if (decision === "rejected") {
      counts[band].decided += 1;
    }
    // pending → ignored
  }

  const byBand = {} as Record<Confidence, BandStat>;
  let totalDecided = 0;
  for (const band of BANDS) {
    const { decided, approved } = counts[band];
    totalDecided += decided;
    byBand[band] = {
      band,
      decided,
      approved,
      approvalRate: decided === 0 ? 0.5 : approved / decided,
    };
  }

  return { byBand, totalDecided };
}
