/**
 * src/bootstrap/types.ts
 *
 * Core types for the Phase 10 Bootstrap Auto-Provisioning layer.
 *
 * Bootstrap = "getting started" flow:
 *   - Check what credentials/authority the user has
 *   - Plan what can be automated vs what requires manual action
 *   - Execute automated steps behind explicit gates
 *   - Generate exact commands for manual steps
 *
 * Not a replacement for provisioning — a UX layer on top of it.
 */

export type BootstrapStatus =
  | "ready"            // env present, gate open, implementation clean
  | "manual_required"  // no clean automated path — exact commands provided
  | "missing_env"      // required env vars not configured
  | "gate_missing"     // gate env var needs to be set
  | "degraded"         // configured but with caveats
  | "skipped"          // skipped by design (optional step)
  | "applied";         // executed successfully

export interface BootstrapStep {
  id: string;
  provider: string;
  action: string;
  status: BootstrapStatus;
  /** Safe message — no secrets */
  message: string;
  manualRequired: boolean;
  /** Gate env var name required to execute this step */
  requiredGate?: string;
  /** Exact next action for the user — never includes secret values */
  nextAction: string;
  /** Exact CLI/dashboard commands for manual steps */
  manualCommands?: string[];
}

export interface BootstrapPlan {
  agentName: string;
  timestamp: string;
  steps: BootstrapStep[];
  missingGates: string[];
  missingEnv: string[];
  readyCount: number;
  manualCount: number;
  missingEnvCount: number;
  summary: string;
}

export interface BootstrapResult {
  agentName: string;
  status: BootstrapStatus;
  plan: BootstrapPlan;
  results: BootstrapStep[];
  timestamp: string;
  summary: string;
}

export interface BootstrapOptions {
  agentName?: string;
  /** Inject custom env for testing. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Override reports directory. Default: bootstrap-reports/ */
  reportsDir?: string;
}

/** Provider scope check result — what this token can do */
export interface ProviderScopeResult {
  provider: string;
  configured: boolean;
  missingEnv: string[];
  /** Safe capabilities list — no token values */
  capabilities: string[];
  limitations: string[];
  safeSummary: string;
}

/** Maps a secret env var to where it needs to be configured */
export interface SecretDestination {
  envVarName: string;
  description: string;
  destinations: string[];
  /** Exact CLI commands to set this secret (placeholders, no real values) */
  commands: string[];
  docs: string;
}
