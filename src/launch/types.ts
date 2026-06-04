/**
 * src/launch/types.ts
 *
 * Core types for the Phase 8 staging launch orchestration.
 * Wraps the Phase 6-7 provisioning engine into a one-command launch flow.
 */

import type { ProviderAdapter } from "../provisioning/types.js";

// ─── Launch status ────────────────────────────────────────────────────────────

export type LaunchStatus =
  | "success"                      // All steps ok, smoke passed
  | "partial"                      // Some steps manual_required or degraded, but not blocked
  | "blocked_missing_gate"         // Global or env gate missing — no mutations ran
  | "blocked_manual_required"      // Mutations needed but all returned manual_required
  | "blocked_no_staging_proof"     // Phase 9: no staging launch report exists
  | "blocked_staging_not_green"    // Phase 9: staging report exists but not success
  | "failed";                      // At least one step returned failed

export type LaunchStepStatus =
  | "success"
  | "skipped"
  | "manual_required"
  | "gate_missing"
  | "degraded"
  | "failed";

// ─── Launch step ─────────────────────────────────────────────────────────────

export interface LaunchStep {
  id: string;
  name: string;
  provider: string;
  status: LaunchStepStatus;
  /** Safe message — no secrets */
  message: string;
  manualRequired: boolean;
  missingGates: string[];
  nextAction: string;
  timestamp: string;
}

// ─── Launch report ────────────────────────────────────────────────────────────

export interface LaunchReport {
  agentName: string;
  environment: "staging";
  launchStatus: LaunchStatus;
  timestamp: string;
  steps: LaunchStep[];
  /** All gate names that were missing across the launch */
  missingGates: string[];
  /** Step IDs that returned manual_required */
  manualRequiredSteps: string[];
  smokeResult: "passed" | "failed" | "skipped";
  /** Path to provision-reports/ report if written */
  provisionReportPath: string | null;
  /** Path to rollback plan if written */
  rollbackPlanPath: string | null;
  nextAction: string;
  safeSummary: string;
}

// ─── Launch options ───────────────────────────────────────────────────────────

export interface StagingLaunchOptions {
  agentName?: string;
  /** Inject custom adapters for testing. Default: all real adapters. */
  adapters?: ProviderAdapter[];
  /** Inject custom env for testing. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Override reports directory. Default: launch-reports/ */
  reportsDir?: string;
}

// ─── Production launch options ───────────────────────────────────────────────

export interface ProductionLaunchOptions {
  agentName?: string;
  adapters?: ProviderAdapter[];
  env?: Record<string, string | undefined>;
  reportsDir?: string;
  /** If true, allow promoting even if staging was partial (not full success) */
  allowPartialStagingPromotion?: boolean;
}

// ─── Staging proof ────────────────────────────────────────────────────────────

export interface StagingProof {
  found: boolean;
  status: LaunchStatus | null;
  timestamp: string | null;
  path: string | null;
  agentName: string | null;
}

// ─── Release comparison ───────────────────────────────────────────────────────

export interface ReleaseComparison {
  baseline: { timestamp: string; status: LaunchStatus; path: string } | null;
  current: { timestamp: string; status: LaunchStatus; path: string } | null;
  changes: ReleaseChange[];
  summary: string;
}

export interface ReleaseChange {
  type: "status_changed" | "new_manual_required" | "resolved_manual_required" | "smoke_changed";
  description: string;
}

// ─── Observability result ─────────────────────────────────────────────────────

export interface ObservabilityResult {
  status: "ok" | "degraded" | "missing_env" | "error";
  recentEvents: number;
  errorRate: number | null;
  message: string;
  nextAction: string;
}

// ─── Readiness ────────────────────────────────────────────────────────────────

export interface ReadinessItem {
  name: string;
  ok: boolean;
  note: string;
}

export interface LaunchReadinessResult {
  ready: boolean;
  checks: ReadinessItem[];
  missingGates: string[];
  warnings: string[];
}
