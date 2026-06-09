/**
 * src/awareness/memory-capture.ts
 *
 * The Executive Memory capture step — the one Node-side action that makes the memory loop real.
 * Given a freshly-computed Strategic Brief, it projects a compact snapshot and folds it into the
 * store under the compactness policy. This is what a host calls on a cadence (a daily heartbeat).
 *
 * Safety:
 *   - FLAG-GATED + default OFF: nothing is captured unless HARTOS_MEMORY_CAPTURE=true.
 *   - Read-shaped: it reads the store + appends one policied list write. No provider/network
 *     mutation, no execution path. The Worker never calls this (it has no store).
 *   - HONEST: only an `ok` brief is worth remembering; an insufficient-evidence brief is skipped
 *     (we never persist a snapshot of "we knew nothing"), keeping memory meaningful.
 */

import { snapshotFromBrief, type DecisionRecord } from "./executive-memory.js";
import type { StrategicBrief } from "./strategic-awareness.js";
import { recordSnapshot, type CapturePolicy, type MemoryStore } from "./memory-store.js";

export const MEMORY_CAPTURE_FLAG = "HARTOS_MEMORY_CAPTURE";

export interface CaptureDeps extends CapturePolicy {
  store: MemoryStore;
  brief: StrategicBrief;
  /** Injected ISO timestamp — no ambient clock. */
  now: string;
  /** Environment for the flag check (default-OFF). */
  env?: Record<string, string | undefined>;
  /** Optional meaningful decisions to attach to this snapshot. */
  decisions?: DecisionRecord[];
}

export interface CaptureResult {
  captured: boolean;
  reason: string;
  /** Total snapshots in the store after the (possible) capture. */
  total: number;
}

function flagOn(env: Record<string, string | undefined> | undefined): boolean {
  return String(env?.[MEMORY_CAPTURE_FLAG] ?? "").trim().toLowerCase() === "true";
}

/**
 * Capture one snapshot of the current brief into the store, under the flag + the compactness
 * policy. Returns what happened (captured / skipped + why) and the resulting store size. Never
 * throws on policy decisions; storage errors propagate to the caller (a host can log/retry).
 */
export async function captureSnapshot(deps: CaptureDeps): Promise<CaptureResult> {
  const current = await deps.store.read();
  if (!flagOn(deps.env)) {
    return { captured: false, reason: `capture disabled — set ${MEMORY_CAPTURE_FLAG}=true to enable`, total: current.length };
  }
  if (deps.brief.status !== "ok") {
    return { captured: false, reason: "brief is insufficient_evidence — nothing worth remembering", total: current.length };
  }
  const snap = snapshotFromBrief(deps.brief, deps.now, deps.decisions);
  const next = recordSnapshot(current, snap, { windowDays: deps.windowDays, maxSnapshots: deps.maxSnapshots });
  await deps.store.save(next);
  return { captured: true, reason: "snapshot recorded (dedupe-by-day, window-pruned, capped)", total: next.length };
}
