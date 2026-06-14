/**
 * src/runtime/views/agent-registry-view.ts
 *
 * A PURE, Worker-safe read-only cockpit view-builder that renders the dynamic Agent Registry from
 * source-of-truth records (AgentManifest[]) + a liveness read-model + recent proposals + arming.
 *
 * Design: docs/superpowers/specs/2026-06-14-dynamic-agent-registration-cockpit.md.
 *
 * Constitutional requirement (Hart, 2026-06-14): the cockpit is a VISUALIZATION of the source of
 * truth, not a static dashboard. Each agent's DISPLAYED status is NEVER stored — it is DERIVED at
 * read time from manifest lifecycle + liveness read-model + arming, via `deriveAgentStatus`.
 * Nothing is "live" unless its manifest is approved AND a health read-model confirms it
 * (liveness.state === "up"); a manifest with no liveness read-model resolves to "watch", never
 * "live" (the health-confirmation invariant). Scaffolded-but-unapproved => draft/pending.
 *
 * This module COMPOSES the canon — it imports `AgentManifest` + `deriveAgentStatus` from the
 * agent-manifest contract and reuses the derivation VERBATIM rather than re-implementing the §3
 * rules. It only projects each manifest (+ its matched liveness verdict + its most-recent
 * proposal) into a render-ready `RenderedAgent`.
 *
 * PURE / Worker-safe: no node: imports, no network, no clock, NEVER throws. It tolerates
 * missing/partial/malformed input — a bad manifest degrades safely (health "unknown", never
 * "live"), and `[]` / `undefined` / garbage inputs yield a safe (possibly empty) array. It
 * DESCRIBES + PROJECTS; it never executes, persists, fetches, or reads the filesystem/env/clock.
 */

import { deriveAgentStatus, type AgentManifest, type DerivedStatus, type AgentLifecycle } from "../../agents/agent-manifest.js";

/** Liveness read-model verdict for a single agent (one row of the Sentinel read-model). */
export interface AgentLivenessVerdict {
  agentId: string;
  state: "up" | "stale" | "down" | "unknown";
  /** ISO timestamp of the last health evidence, or null/absent if none. */
  lastEvidenceAt?: string | null;
  /** Age of the last evidence in hours, or null/absent if not computed. */
  ageHours?: number | null;
}

/** A recent proposal row, used to surface each agent's most-recent activity. */
export interface AgentProposalRow {
  /** The agent this proposal targets (matched against `manifest.agentId`). */
  targetId?: string;
  domain?: string;
  status?: string;
  updatedAt?: string | null;
  title?: string;
}

/** Input to {@link agentRegistryView}. All fields except `manifests` are optional. */
export interface AgentRegistryViewInput {
  manifests: AgentManifest[];
  liveness?: { verdicts: AgentLivenessVerdict[] };
  proposals?: AgentProposalRow[];
  killSwitchOn?: boolean;
}

/** The most-recent proposal that targets an agent, projected read-only. */
export interface RenderedActivity {
  title: string;
  status: string;
  updatedAt: string | null;
}

/** Honest arming state for an agent's hands. */
export interface RenderedArming {
  /** The env flag that arms its hands (e.g. "HARTOS_ALLOW_SELF_MOD"), or null if none. */
  flag: string | null;
  /**
   * Whether the agent's hands are armed. `false` when the kill-switch is on AND it can execute
   * (disarmed); otherwise a null flag => `true` (nothing to arm = effectively armed/N-A).
   */
  armed: boolean;
}

/** A single render-ready agent row, derived purely from truth. */
export interface RenderedAgent {
  agentId: string;
  displayName: string;
  capabilitySummary: string;
  tier: string;
  lifecycle: AgentLifecycle;
  /** Computed-at-read-time displayed status (via `deriveAgentStatus`). */
  derivedStatus: DerivedStatus;
  /** The liveness read-model state, or "unknown" when there is no verdict for this agent. */
  health: "up" | "stale" | "down" | "unknown";
  /** ISO timestamp of the last health evidence, or null. */
  lastHeartbeat: string | null;
  arming: RenderedArming;
  permissions: { propose: boolean; execute: boolean };
  /** The most-recent proposal whose targetId === agentId, or null. */
  latestActivity: RenderedActivity | null;
  knownRisks: string[];
}

const VALID_HEALTH: readonly string[] = ["up", "stale", "down", "unknown"];

/** Safe string coercion — never throws, never surfaces a non-string. */
function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Safe ISO-or-null coercion for timestamps. */
function asNullableString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Normalise a liveness verdict's state into the 4 known bands, defaulting to "unknown". */
function normaliseHealth(state: unknown): "up" | "stale" | "down" | "unknown" {
  return typeof state === "string" && VALID_HEALTH.includes(state)
    ? (state as "up" | "stale" | "down" | "unknown")
    : "unknown";
}

/** Safe string-array coercion — drops non-strings, never throws, never aliases the source. */
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Index liveness verdicts by agentId. If duplicates exist for an agent, the LAST one wins (the
 * caller is expected to supply newest-last per agent; this view does not invent a sort key).
 * Tolerates a missing/garbage verdicts list by returning an empty map.
 */
function indexLiveness(verdicts: unknown): Map<string, AgentLivenessVerdict> {
  const map = new Map<string, AgentLivenessVerdict>();
  if (!Array.isArray(verdicts)) return map;
  for (const v of verdicts) {
    const id = asString((v as AgentLivenessVerdict | undefined)?.agentId);
    if (id) map.set(id, v as AgentLivenessVerdict);
  }
  return map;
}

/**
 * Pick the most-recent proposal targeting `agentId`. "Most recent" = the largest parseable
 * `updatedAt`; rows with an unparseable/absent `updatedAt` are kept as a fallback only if nothing
 * dated is found, in INPUT order (last one wins among undated). Pure — no clock, never throws.
 */
function latestActivityFor(agentId: string, proposals: AgentProposalRow[]): RenderedActivity | null {
  let best: AgentProposalRow | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  let undatedFallback: AgentProposalRow | null = null;

  for (const p of proposals) {
    if (asString(p?.targetId) !== agentId) continue;
    const raw = asNullableString(p?.updatedAt);
    const t = raw ? new Date(raw).getTime() : Number.NaN;
    if (!Number.isNaN(t)) {
      if (t >= bestTime) {
        bestTime = t;
        best = p;
      }
    } else {
      // Undated (or unparseable) row — remember the latest one in input order as a fallback.
      undatedFallback = p;
    }
  }

  const chosen = best ?? undatedFallback;
  if (!chosen) return null;
  return {
    title: asString(chosen.title),
    status: asString(chosen.status),
    updatedAt: asNullableString(chosen.updatedAt),
  };
}

/**
 * Compute honest arming from the manifest + kill-switch. `armed` is `false` when the kill-switch
 * is on AND the agent can execute (disarmed hands); otherwise a null arming flag means there is
 * nothing to arm, so `armed` is `true` (effectively armed / not-applicable). A real flag with the
 * kill-switch off is `armed: true`.
 */
function deriveArming(manifest: AgentManifest, killSwitchOn: boolean): RenderedArming {
  const flag = asNullableString(manifest?.armingFlag);
  const canExecute = manifest?.permissions?.execute === true;
  if (killSwitchOn && canExecute) return { flag, armed: false };
  return { flag, armed: true };
}

/**
 * PURE. Project source-of-truth manifests (+ liveness read-model + recent proposals + arming) into
 * render-ready `RenderedAgent` rows.
 *
 * For each manifest:
 *   - `derivedStatus` is computed VERBATIM by `deriveAgentStatus(manifest, liveness, { killSwitchOn })`
 *     — the §3 rules are NOT re-implemented here. Health-confirmation invariant holds: a manifest
 *     with no liveness verdict passes `{ state: "unknown" }` to the deriver, so an approved agent
 *     with no health read-model resolves to "watch" (approved-but-unconfirmed), NEVER "live".
 *   - `health` is the matched verdict's state, or "unknown" when there is no verdict.
 *   - `latestActivity` is the most-recent proposal whose `targetId === agentId`, or null.
 *
 * Tolerates missing/partial/malformed input WITHOUT throwing:
 *   - `undefined` / a non-object input / a non-array `manifests` => `[]`.
 *   - a malformed manifest entry degrades safely with health "unknown" (the deriver and the
 *     safe-extraction helpers absorb the malformation) and is NEVER "live" — with no health
 *     read-model an unconfirmed manifest is approved-but-unconfirmed-shaped => "watch".
 *
 * No I/O, no fetch, no env, no clock — derives the view from the supplied input and nothing else.
 */
export function agentRegistryView(input: AgentRegistryViewInput | null | undefined): RenderedAgent[] {
  const manifests = Array.isArray(input?.manifests) ? input!.manifests : [];
  const killSwitchOn = input?.killSwitchOn === true;
  const livenessIndex = indexLiveness(input?.liveness?.verdicts);
  const proposals = Array.isArray(input?.proposals) ? input!.proposals : [];

  const out: RenderedAgent[] = [];
  for (const manifest of manifests) {
    // Defensive: skip only truly non-object entries; malformed-but-object manifests degrade safely.
    if (manifest == null || typeof manifest !== "object") continue;

    const agentId = asString(manifest.agentId);
    const verdict = agentId ? livenessIndex.get(agentId) : undefined;

    // Health-confirmation invariant: an absent read-model is semantically "unknown" health, NOT a
    // hard "down". We pass `{ state: "unknown" }` (never `null`) for a missing verdict so the
    // deriver yields "watch" (approved-but-unconfirmed) rather than "offline" — and CRUCIALLY never
    // "live": only a real "up" verdict can confirm health. A verdict's state flows straight in.
    const livenessState = verdict ? normaliseHealth(verdict.state) : "unknown";
    const derivedStatus = deriveAgentStatus(manifest, { state: livenessState }, { killSwitchOn });

    const permissions = {
      propose: manifest?.permissions?.propose === true,
      execute: manifest?.permissions?.execute === true,
    };

    out.push({
      agentId,
      displayName: asString(manifest.displayName),
      capabilitySummary: asString(manifest.capabilitySummary),
      tier: asString(manifest.tier),
      // `deriveAgentStatus` already absorbed a malformed lifecycle; for the authored `lifecycle`
      // field we pass through the raw value when it is a string, else default to "draft".
      lifecycle: (typeof manifest.lifecycle === "string" ? manifest.lifecycle : "draft") as AgentLifecycle,
      derivedStatus,
      health: verdict ? normaliseHealth(verdict.state) : "unknown",
      lastHeartbeat: verdict ? asNullableString(verdict.lastEvidenceAt) : null,
      arming: deriveArming(manifest, killSwitchOn),
      permissions,
      latestActivity: agentId ? latestActivityFor(agentId, proposals) : null,
      knownRisks: asStringArray(manifest.knownRisks),
    });
  }

  return out;
}
