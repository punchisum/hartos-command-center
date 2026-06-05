/**
 * src/execution/index.ts
 *
 * Phase 17D — Node execution-host entry point. Local scaffold DRY-RUN only; no provider mutation,
 * no push, no real execution. See docs/AGENT_CREATION_LOCAL_DRYRUN_PHASE17D.md.
 */

export {
  runLocalScaffoldDryRun,
  DryRunPreconditionError,
  DEFAULT_DRYRUN_DIR,
} from "./local-scaffold-dryrun.js";
export type {
  LocalScaffoldDryRunOptions,
  LocalScaffoldDryRunResult,
  DryRunArtifact,
  ProviderDryRunReport,
  ProviderDryRunStep,
} from "./local-scaffold-dryrun.js";

// ─── Phase 18A — controlled execution / PR mode (local-only) ─────────────────
export {
  runLocalScaffoldBuild,
  rollbackLocalScaffold,
  ScaffoldBuildPreconditionError,
  DEFAULT_SCAFFOLD_DIR,
  LOCAL_SCAFFOLD_GATE,
} from "./local-scaffold-build.js";
export type { LocalScaffoldBuildOptions, LocalScaffoldBuildResult } from "./local-scaffold-build.js";
export { realLocalGit, type LocalGitOps } from "./local-git.js";
export { realFactoryScaffold, type ScaffoldFn, type ScaffoldRequest, type ScaffoldOutcome } from "./scaffold-via-factory.js";

// ─── Phase 18B — controlled GitHub PR mode (first external mutation, gated) ────
export {
  runGithubPrMode,
  runGithubPrRollback,
  GithubPrPreconditionError,
  PUSH_GATE,
  PR_GATE,
  REMOTE_ROLLBACK_GATE,
} from "./run-github-pr.js";
export type { GithubPrOptions, GithubPrResult, GithubPrRollbackResult } from "./run-github-pr.js";
export { realGitHubPrOps, type GitHubPrOps } from "./github-pr.js";

// ─── Phase 18C — first data-layer provisioning (gated Supabase migration apply) ──
export {
  runDataLayerProvision,
  runDataLayerRollback,
  DataProvisionPreconditionError,
  DEFAULT_DATA_PROVISION_REPORTS_DIR,
} from "./agent-data-provision.js";
export type {
  DataProvisionOptions,
  DataProvisionResult,
  DataProvisionRollbackResult,
  ScannedMigration,
  MigrationInventory,
  DataProvisionLedgerEntry,
} from "./agent-data-provision.js";
export {
  realSupabaseMigrationApplyOps,
  createMockApplyOps,
  buildDbPushArgs,
  type SupabaseMigrationApplyOps,
  type ApplyParams,
} from "../supabase/migration-apply-ops.js";
