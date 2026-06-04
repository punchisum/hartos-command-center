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
