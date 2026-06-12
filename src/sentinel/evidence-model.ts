/**
 * src/sentinel/evidence-model.ts — the truth layer's EVIDENCE INTAKE (PURE core).
 *
 * Raw evidence from many source types (Worker request time, Supabase read-model snapshots,
 * local-runner job artifacts, Trigger.dev/cron logs) is messy: timestamps can be missing,
 * unparseable, or even in the future. This module normalizes one raw record into a Sentinel
 * `AgentHeartbeat`, applying the single honesty rule that makes the truth layer trustworthy:
 * if a timestamp is not a real past instant, it is NOT evidence of a run.
 *
 * PURE: no I/O, no clock (now injected), no env. Feeds assessFleetLiveness().
 */

import type { AgentHeartbeat } from "./sentinel-liveness.js";

/** One raw observation of an agent having (maybe) produced output. */
export interface RawEvidence {
  agentId: string;
  /** Timestamp as reported by the source — may be null, malformed, or in the future. */
  observedAt: string | null;
  /** Where the observation came from (read-model, artifact dir, worker, cron) — honesty. */
  evidenceSource: string;
  /** An upstream freshness system already judged this source stale; carry it through. */
  upstreamStale?: boolean;
}

export function normalizeEvidence(raw: RawEvidence, now: string): AgentHeartbeat {
  const nowMs = Date.parse(now);
  const observedMs = raw.observedAt === null ? NaN : Date.parse(raw.observedAt);
  // Evidence counts only if it is a real instant at or before `now`. A missing, unparseable,
  // or future timestamp is dropped to null so the agent surfaces as "unknown" — never "up".
  const trustworthy =
    Number.isFinite(observedMs) && Number.isFinite(nowMs) && observedMs <= nowMs;
  return {
    agentId: raw.agentId,
    lastEvidenceAt: trustworthy ? raw.observedAt : null,
    evidenceSource: raw.evidenceSource,
    ...(raw.upstreamStale ? { upstreamStale: true } : {}),
  };
}
