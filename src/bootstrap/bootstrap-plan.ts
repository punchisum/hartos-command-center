/**
 * src/bootstrap/bootstrap-plan.ts
 *
 * Build a bootstrap plan — shows what would happen per provider.
 * No mutations. Delegates to bootstrap-check.ts.
 */

export { checkBootstrap as buildBootstrapPlan } from "./bootstrap-check.js";
export type { BootstrapPlan } from "./types.js";
