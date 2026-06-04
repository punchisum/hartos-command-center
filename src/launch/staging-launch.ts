/**
 * src/launch/staging-launch.ts
 *
 * Public entry point for the staging launch.
 * Called by scripts/launch-staging.ts and by tests.
 */

export { runStagingLaunch } from "./orchestrator.js";
export type { StagingLaunchOptions, LaunchReport, LaunchStep, LaunchStatus } from "./types.js";
export { formatLaunchReport, writeLaunchReport } from "./report.js";
export { checkLaunchReadiness } from "./readiness.js";
