/**
 * src/cockpit/cockpit.ts
 *
 * Entry point that ties the Local Visible Cockpit together. It builds the
 * cockpit state, renders HTML, and exposes the Orchestrator bridge + server.
 * Everything is LOCAL: no network, no provider/Supabase/pack mutation, no
 * deploys. The cockpit is a visible control surface over the Orchestrator brain
 * and the Command Center contract; it never executes a dangerous action.
 */

import path from "node:path";
import type { CockpitState } from "./cockpit-types.js";
import { buildCockpitState } from "./cockpit-read-model.js";
import { renderCockpitHtml } from "./cockpit-renderer.js";

export { buildCockpitState } from "./cockpit-read-model.js";
export { renderCockpitHtml } from "./cockpit-renderer.js";
export { askOrchestrator, makeMessageInput, CockpitRequestError } from "./cockpit-orchestrator-bridge.js";
export { routeRequest, createCockpitServer, startCockpitServer } from "./cockpit-server.js";
export {
  DEFAULT_COCKPIT_REPORTS_DIR,
  DEFAULT_COCKPIT_THREADS_DIR,
  writeSnapshotReport,
} from "./cockpit-report.js";
export { validateRequest } from "./cockpit-state.js";

export interface CockpitSnapshot {
  state: CockpitState;
  html: string;
}

export interface CockpitOptions {
  cwd?: string;
}

/** Build a deterministic, render-ready cockpit snapshot. Safe with no reports. */
export async function buildCockpitSnapshot(options: CockpitOptions = {}): Promise<CockpitSnapshot> {
  const cwd = options.cwd ?? process.cwd();
  const state = await buildCockpitState({ cwd });
  const html = renderCockpitHtml(state, { serverMode: false });
  return { state, html };
}

export function resolveCockpitReportsDir(cwd: string, override?: string): string {
  if (override) return path.resolve(cwd, override);
  return path.resolve(cwd, "cockpit-reports");
}
