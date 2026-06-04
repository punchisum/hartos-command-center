/**
 * src/provisioning/types.ts
 *
 * Core types for the Phase 6 provisioning engine.
 * Phase 7 will add real provider apply() implementations.
 */

export type ProviderName =
  | "github"
  | "supabase"
  | "cloudflare"
  | "trigger"
  | "telegram"
  | "openai";

export type ProvisionAction =
  | "create_repo"
  | "create_project"
  | "apply_migrations"
  | "set_secret"
  | "deploy_worker"
  | "register_webhook"
  | "register_task"
  | "verify_model"
  | "run_smoke"
  | "set_remote"     // Phase 7A: set git remote origin
  | "initial_push"   // Phase 7A: initial git push to remote
  | "verify_health"  // Phase 7B: check provider /health endpoint
  | "verify_bot"     // Phase 7C: verify Telegram bot token via getMe
  | "verify_webhook" // Phase 7C: verify Telegram webhook registration
  | "test_send"      // Phase 7C: send a safe test message to a debug chat
  | "verify_tables"   // Phase 7D: check required Supabase tables exist
  | "verify_project"  // Phase 7E: verify Trigger.dev project is accessible
  | "verify_task";    // Phase 7E: verify expected Trigger.dev tasks are registered

export type ProvisionStepStatus =
  | "planned"
  | "skipped"
  | "applied"
  | "verified"
  | "failed"
  | "not_implemented"
  | "gate_missing"
  | "already_exists"   // Phase 7A: resource already exists (idempotent success)
  | "created"          // Phase 7A: resource was created
  | "manual_required"  // Phase 7B: action requires manual steps (e.g. secret upload)
  | "degraded";        // Phase 7C: partially configured — reduced capability or security

export type ProvisionEnvironment = "local" | "staging" | "production";

export type ProviderAdapterStatus = "configured" | "missing_env" | "not_implemented" | "error" | "degraded";

// ─── Core step shape ─────────────────────────────────────────────────────────

export interface RollbackStep {
  description: string;
  command?: string;
  notes?: string;
}

export interface ProvisionStep {
  id: string;
  provider: ProviderName;
  action: ProvisionAction;
  environment: ProvisionEnvironment;
  /** true = has side effects on external infrastructure */
  mutation: boolean;
  /** env var name that must equal "true" to allow this step */
  requiredGate?: string;
  /** if true, CONFIRM_PRODUCTION_DEPLOY must also be "true" */
  productionGateRequired?: boolean;
  description: string;
  /** Safe summary — never include secrets, tokens, or raw keys */
  safeSummary: string;
  rollback?: RollbackStep;
  status?: ProvisionStepStatus;
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export interface ProvisionPlan {
  agentName: string;
  environment: ProvisionEnvironment;
  timestamp: string;
  steps: ProvisionStep[];
  totalSteps: number;
  mutatingSteps: number;
  readOnlySteps: number;
}

// ─── Results ─────────────────────────────────────────────────────────────────

export interface ProvisionStepResult {
  step: ProvisionStep;
  status: ProvisionStepStatus;
  message: string;
  timestamp: string;
}

export interface ProvisionResult {
  plan: ProvisionPlan;
  results: ProvisionStepResult[];
  timestamp: string;
  success: boolean;
  skippedCount: number;
  appliedCount: number;
  failedCount: number;
  notImplementedCount: number;
  gateMissingCount: number;
}

// ─── Ledger ──────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  timestamp: string;
  environment: ProvisionEnvironment;
  provider: ProviderName;
  stepId: string;
  action: ProvisionAction;
  status: ProvisionStepStatus;
  message: string;
  rollbackAvailable: boolean;
  failureCode?: string;
}

export interface ProvisionLedger {
  agentName: string;
  entries: LedgerEntry[];
  lastUpdated: string;
}

// ─── Provider verification ───────────────────────────────────────────────────

export interface ProviderVerificationResult {
  provider: ProviderName;
  status: ProviderAdapterStatus;
  missingEnv: string[];
  supportedActions: ProvisionAction[];
  unsupportedActions: ProvisionAction[];
  /** Safe guidance, no secrets */
  nextAction: string;
  safeSummary: string;
}

// ─── Context passed to adapters ──────────────────────────────────────────────

export interface ProvisionContext {
  agentName: string;
  environment: ProvisionEnvironment;
  /** Pass process.env or a filtered subset — never log this object directly */
  env: Record<string, string | undefined>;
}

// ─── Provider adapter interface ───────────────────────────────────────────────
// Phase 6: only plan() and verify() are required.
// Phase 7: real apply() and rollback() implementations.

export interface ProviderAdapter {
  readonly provider: ProviderName;
  plan(context: ProvisionContext): Promise<ProvisionStep[]>;
  verify(context: ProvisionContext): Promise<ProviderVerificationResult>;
  apply?(step: ProvisionStep, context: ProvisionContext): Promise<ProvisionStepResult>;
  rollback?(step: RollbackStep, context: ProvisionContext): Promise<ProvisionStepResult>;
}
