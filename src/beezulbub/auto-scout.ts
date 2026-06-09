/**
 * src/beezulbub/auto-scout.ts
 *
 * Beezulbub spec-lock → auto-scout orchestration (plan §5).
 *
 * A PURE orchestration that, given a LOCKED AgentSpec, produces a scout request
 * and assembles a unified BeezulbubCapabilityReport. It is the "spec-lock →
 * auto-scout trigger" gap called out in plan §5.
 *
 * Doctrine (plan §1/§5/§19):
 *   - Network scouting stays behind the EXISTING `BEEZULBUB_ALLOW_NETWORK` gate
 *     (read inside scout.ts/live-scout.ts/github-search.ts). This module NEVER
 *     sets that env var and NEVER enables network on its own. The default path
 *     uses fixtures only. An `allowNetwork` *option* merely opts into the live
 *     code path — the env var is still the authoritative gate, so with the flag
 *     unset the scout degrades to fixtures and no fetch is ever invoked.
 *   - No auto-import of remote code: this module composes scout results into an
 *     advisory report. `proposedBuildPlanChanges` stays `[]` — folding patterns
 *     into a build plan happens in a later slice and always needs Hart approval.
 *   - No I/O beyond delegating to scoutCandidates: no fs writes (no
 *     beezulbub-reports/ dir), no build-plan mutation, never throws.
 */

import type {
  BeezulbubCapabilityReport,
  BeezulbubScoutResult,
  ScoutCandidate,
  ScoutOptions,
} from "./types.js";
import { scoutCandidates } from "./scout.js";
import {
  buildCapabilityReport,
  type CapabilityReportInputs,
} from "./capability-report.js";

/**
 * The minimal locked-spec shape this module needs. There is no `AgentSpec` TS
 * type in this repo, and Beezulbub must NOT reach into the sibling
 * hartos-agent-factory — so we define a small LOCAL contract here.
 */
export interface LockedAgentSpec {
  /** The AgentSpec this scout run serves (matches Factory specId). */
  agentSpecId: string;
  /** The capability the Factory wants scouted (maps to the scout `target`). */
  targetCapability: string;
  /** Optional free-text notes recorded into the report's searchScope. */
  searchNotes?: string;
}

/**
 * Options for the auto-scout orchestration.
 *
 * `allowNetwork` is forwarded as an *intent to use the live code path* — it is
 * NEVER written to `process.env`. The existing `BEEZULBUB_ALLOW_NETWORK` env
 * gate (read by scout.ts) remains the real switch; with it unset the scout
 * falls back to fixtures regardless of this option.
 */
export interface AutoScoutOptions {
  /** Opt into the live scout code path. Default false ⇒ fixture-only. */
  allowNetwork?: boolean;
  /** Max live candidates (only relevant on the live path). */
  limit?: number;
  /** Injectable fetch for the live path; never called on the fixture path. */
  fetchImpl?: typeof fetch;
  /** Beezulbub's own confidence before §19 bounding (0-1). */
  baseConfidence?: number;
  /** Upstream confidences this report aggregates over (each 0-1). */
  inputConfidences?: number[];
  /** Override generation timestamp (ISO). Defaults to now (inject for tests). */
  generatedAt?: string;
}

/**
 * Map a locked spec to a `ScoutOptions` request.
 *
 * Only sets `live: true` when `allowNetwork` is explicitly requested; otherwise
 * the scout uses its fixture branch directly. This forwards the network intent
 * WITHOUT ever touching `process.env` — the env gate stays authoritative.
 */
export function specLockToScoutRequest(
  spec: LockedAgentSpec,
  opts: AutoScoutOptions = {}
): ScoutOptions {
  const request: ScoutOptions = {
    target: spec.targetCapability,
  };
  // Opt into the live code path only on explicit request. The actual network
  // call still requires BEEZULBUB_ALLOW_NETWORK=true (read inside scout.ts).
  if (opts.allowNetwork) {
    request.live = true;
  }
  if (opts.limit !== undefined) {
    request.limit = opts.limit;
  }
  if (opts.fetchImpl !== undefined) {
    request.fetchImpl = opts.fetchImpl;
  }
  return request;
}

/**
 * Assemble a unified BeezulbubCapabilityReport from a scout result.
 *
 * Pure transform via `buildCapabilityReport`:
 *   - candidateSources = scoutResult.candidates (composed, never redefined)
 *   - searchScope = { target, mode: scoutResult.mode, notes }
 *   - proposedBuildPlanChanges stays [] (advisory; build-plan feedback is later)
 */
export function assembleReportFromScout(
  spec: LockedAgentSpec,
  scoutResult: BeezulbubScoutResult,
  extra: Pick<
    AutoScoutOptions,
    "baseConfidence" | "inputConfidences" | "generatedAt"
  > = {}
): BeezulbubCapabilityReport {
  const candidateSources: ScoutCandidate[] = scoutResult.candidates;

  const inputs: CapabilityReportInputs = {
    agentSpecId: spec.agentSpecId,
    searchScope: {
      target: scoutResult.target,
      mode: scoutResult.mode,
      ...(spec.searchNotes !== undefined ? { notes: spec.searchNotes } : {}),
    },
    candidateSources,
    // Advisory only — never auto-applied. Build-plan feedback is a later slice.
    proposedBuildPlanChanges: [],
    auditTrail: [
      {
        at: scoutResult.timestamp,
        stage: "scout",
        detail:
          `Auto-scouted "${scoutResult.target}" (mode ${scoutResult.mode}); ` +
          `${candidateSources.length} candidate source(s).`,
      },
    ],
    ...(extra.baseConfidence !== undefined
      ? { baseConfidence: extra.baseConfidence }
      : {}),
    ...(extra.inputConfidences !== undefined
      ? { inputConfidences: extra.inputConfidences }
      : {}),
    ...(extra.generatedAt !== undefined
      ? { generatedAt: extra.generatedAt }
      : {}),
  };

  return buildCapabilityReport(inputs);
}

/**
 * Compose scout → report for a locked spec.
 *
 * Offline default (no `BEEZULBUB_ALLOW_NETWORK`, no `allowNetwork` option) ⇒ a
 * fixture/degraded report. Never throws: if the scout fails for any reason, an
 * empty-candidate report is assembled with the failure recorded in `unknowns`.
 */
export async function autoScoutForSpec(
  spec: LockedAgentSpec,
  opts: AutoScoutOptions = {}
): Promise<BeezulbubCapabilityReport> {
  const request = specLockToScoutRequest(spec, opts);
  const extra = {
    baseConfidence: opts.baseConfidence,
    inputConfidences: opts.inputConfidences,
    generatedAt: opts.generatedAt,
  };

  try {
    const scoutResult = await scoutCandidates(request);
    return assembleReportFromScout(spec, scoutResult, extra);
  } catch (err) {
    // Fail-closed to a degraded fixture-mode report; surface the cause honestly.
    const message = err instanceof Error ? err.message : "unknown scout error";
    const degraded: BeezulbubScoutResult = {
      target: spec.targetCapability,
      candidates: [],
      timestamp: opts.generatedAt ?? new Date().toISOString(),
      mode: "fixture",
      recommendation: `Scout failed; returning a degraded fixture report.`,
    };
    const report = assembleReportFromScout(spec, degraded, extra);
    return {
      ...report,
      unknowns: [...report.unknowns, `Scout error: ${message}`],
    };
  }
}
