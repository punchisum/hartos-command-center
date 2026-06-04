/**
 * src/runtime/cloudflare-cockpit-types.ts
 *
 * Types for the Cloudflare-hosted read-only cockpit (Phase 11J).
 *
 * The hosted cockpit is a THIN adapter over the existing local cockpit logic.
 * Cloudflare Workers have no filesystem, so the Worker operates on a snapshot
 * CONTEXT that is built once (in Node, at dry-run/deploy time via the existing
 * buildCockpitState/renderCockpitHtml) and handed to the Worker. The Worker
 * itself never reads the filesystem, never mutates anything, and never executes
 * an action.
 */

import type { CockpitState, CockpitReportRef } from "../cockpit/cockpit-types.js";

/** Server-side env available to the hosted cockpit. Values are NEVER exposed. */
export type CloudflareCockpitEnv = Record<string, string | undefined>;

/**
 * A pre-built, render-ready snapshot the Worker serves. Built in Node from the
 * existing cockpit read model; the Worker treats it as immutable read-only data.
 * All fields are optional so the default export stays valid before a snapshot is
 * baked in (it then serves a safe placeholder).
 */
export interface CockpitWorkerContext {
  state?: CockpitState;
  html?: string;
  reports?: CockpitReportRef[];
  threads?: string[];
  /** "hosted" on Cloudflare; informational only. */
  runtimeMode?: string;
  generatedAt?: string;
}

/** Result of a deploy-gate check, following the Factory gate doctrine. */
export interface CockpitDeployGateResult {
  status: "ready" | "blocked_missing_gate";
  missingGates: string[];
  /** Env names whose presence is required (never the values). */
  requiredEnvPresent: { name: string; present: boolean }[];
  message: string;
}

export interface EnvPresence {
  name: string;
  present: boolean;
  secret: boolean;
}

export type CloudflareReportKind = "check" | "dry-run" | "deploy-plan" | "deploy";
