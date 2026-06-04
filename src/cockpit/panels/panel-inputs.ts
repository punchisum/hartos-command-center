/**
 * src/cockpit/panels/panel-inputs.ts
 *
 * Phase 12A — the read-only inputs every domain panel builder consumes. These
 * are produced from the EXISTING boundaries only (agent integration read-model,
 * Supabase read-models, local reports, capability registry). Builders are pure
 * functions of these inputs — no I/O happens inside a builder.
 */

import type { AgentIntegrationSummary } from "../../agents/agent-types.js";
import type { ReadModelRegistrySummary } from "../../read-models/read-model-types.js";
import type { CockpitReportRef } from "../cockpit-types.js";
import type { ResolvedSources } from "../sources/index.js";

/** Non-secret view of the local capability registry (Factory panel). */
export interface CapabilityInfo {
  present: boolean;
  /** Total registered capabilities. */
  count: number;
  /** Capabilities by lifecycle status (e.g. { promoted: 2, draft: 1 }). */
  byStatus: Record<string, number>;
  /** A few representative capability names (already non-secret). */
  names: string[];
}

/** Built-in factory modules detected as present in the runtime. */
export interface ModuleInfo {
  id: string;
  label: string;
  present: boolean;
}

export interface PanelInputs {
  agentIntegration: AgentIntegrationSummary;
  readModels: ReadModelRegistrySummary;
  reports: CockpitReportRef[];
  capability: CapabilityInfo;
  modules: ModuleInfo[];
  now: string;
  /**
   * Phase 13 — resolved read-only sources (live read-model → report → handover,
   * with freshness). Optional: when absent, panel builders derive a source
   * purely from the in-memory summaries, so they stay pure and testable.
   */
  sources?: ResolvedSources;
}
