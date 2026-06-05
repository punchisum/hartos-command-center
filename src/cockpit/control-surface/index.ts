/**
 * src/cockpit/control-surface/index.ts
 *
 * Phase 18E — public surface + snapshot builder. Ties the spine together:
 *   load inputs → assemble bundles (verdict/confidence/severity computed) →
 *   overlay LLM prose (isolated + secret-checked) → derive system verdict,
 *   attention strip, builder view → render HTML.
 *
 * Everything is LOCAL and read-only. Zero provider mutation; no raw secrets.
 */

import type { AgentFactBundle, FixSeverity, Verdict } from "./fact-bundle.js";
import {
  assembleAgentBundles,
  loadControlSurfaceInputs,
  type ControlSurfaceInputs,
  type ControlSurfaceState,
} from "./assemble.js";
import { applySummary, deterministicSummarizer, type FactSummarizer } from "./summarizer.js";
import { computeSystemVerdict, SEVERITY_RANK } from "./verdict-rules.js";
import { buildLifecycleSteps } from "./lifecycle.js";
import {
  renderControlSurfaceHtml,
  type AttentionItem,
  type BuilderView,
  type ControlSurfaceRender,
  type RenderOptions,
} from "./render.js";

export * from "./fact-bundle.js";
export {
  computeFreshness,
  computeVerdict,
  computeConfidence,
  computeSystemVerdict,
  isUnavailable,
  worstFreshness,
  sortFixesBySeverity,
  isAllowedFixAction,
  ALLOWED_FIX_ACTION_KINDS,
  SEVERITY_RANK,
  FRESH_MAX_AGE_MS,
  DEAD_MIN_AGE_MS,
} from "./verdict-rules.js";
export {
  assembleAgentBundles,
  loadControlSurfaceInputs,
  type ControlSurfaceInputs,
  type ControlSurfaceState,
  type TaxInput,
  type ReadModelInput,
  type FactoryInput,
} from "./assemble.js";
export {
  applySummary,
  deterministicSummarizer,
  type FactSummarizer,
  type SummaryDraft,
  type SummaryRequest,
} from "./summarizer.js";
export {
  buildLifecycleSteps,
  completedStageCount,
  LIFECYCLE_STAGES,
  type LifecycleStep,
  type StepState,
} from "./lifecycle.js";
export {
  renderControlSurfaceHtml,
  escapeHtml,
  type ControlSurfaceRender,
  type AttentionItem,
  type BuilderView,
  type RenderOptions,
} from "./render.js";

/** Flatten every agent's fixes into a single severity-ranked attention strip. */
export function buildAttentionStrip(bundles: AgentFactBundle[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const b of bundles) {
    if (b.unavailable) continue; // a missing bundle has no actionable fixes
    for (const fix of b.fixes) {
      items.push({ agentId: b.agentId, severity: fix.severity, title: fix.title, why: fix.why, action: fix.action });
    }
  }
  // Cross-agent sort by COMPUTED severity (stable within tier). security can never sink below note.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const byTier = SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity];
      return byTier !== 0 ? byTier : a.index - b.index;
    })
    .map((x) => x.item);
}

/** Derive the Builder lifecycle view from the assembled inputs (proposal-driven). */
export function buildBuilderView(inputs: ControlSurfaceInputs): BuilderView | null {
  const tax = inputs.tax;
  if (!tax) return null;
  const steps = buildLifecycleSteps(tax.proposalStatus, tax.auditEvents);
  const knownSecrets = ["CLOUDFLARE", "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "TRIGGER_SECRET_KEY"];
  const present = new Set(tax.secretNames);
  const credentials = knownSecrets.map((name) => ({ name, present: present.has(name) }));
  return {
    agentName: "Tax Agent",
    specId: tax.specId,
    status: tax.proposalStatus,
    steps,
    worker: tax.workerHealthOk ? "health 200" : tax.workerHealthOk === false ? "unhealthy" : "not probed",
    environment: tax.targetEnv,
    webhook: tax.webhookSet ? "registered" : "not set",
    trigger: tax.triggerConfigured ? "configured" : "skipped (no config)",
    nextStep: tax.proposalStatus === "runtime_provisioned" ? "Phase 19 usefulness test" : "advance lifecycle",
    credentials,
    missingCredentials: credentials.filter((c) => !c.present).map((c) => c.name),
  };
}

export interface ControlSurfaceSnapshot {
  state: ControlSurfaceRender;
  html: string;
}

export interface BuildSnapshotOptions {
  cwd?: string;
  now?: string;
  /** Inject a model; defaults to the offline deterministic summarizer. */
  summarizer?: FactSummarizer;
  render?: RenderOptions;
  /** Pre-loaded inputs (skip disk). Used by tests/hosted callers. */
  inputs?: ControlSurfaceInputs;
}

/**
 * Build the render-ready control-surface state. Pure-ish: with `inputs` provided
 * it does no I/O at all (hermetic). The summarizer is the only place prose enters,
 * and `applySummary` enforces isolation + unknown-honesty + secret safety.
 */
export async function buildControlSurfaceState(options: BuildSnapshotOptions = {}): Promise<ControlSurfaceRender> {
  const now = options.now ?? new Date().toISOString();
  const cwd = options.cwd ?? process.cwd();
  const inputs = options.inputs ?? (await loadControlSurfaceInputs(cwd, now));
  const summarizer = options.summarizer ?? deterministicSummarizer;

  const bundles = assembleAgentBundles({ ...inputs, now });
  for (const bundle of bundles) {
    await applySummary(bundle, summarizer, now);
  }

  const systemVerdict: Verdict = computeSystemVerdict(bundles.map((b) => b.verdict));
  const attention = buildAttentionStrip(bundles);
  const builder = buildBuilderView({ ...inputs, now });

  return {
    generatedAt: now,
    bundles,
    systemHealth: inputs.systemHealth,
    proposalQueue: inputs.proposalQueue,
    recentActivity: inputs.recentActivity,
    systemVerdict,
    attention,
    builder,
  };
}

/** Build the full snapshot (state + rendered HTML). */
export async function buildControlSurfaceSnapshot(options: BuildSnapshotOptions = {}): Promise<ControlSurfaceSnapshot> {
  const state = await buildControlSurfaceState(options);
  const html = renderControlSurfaceHtml(state, options.render);
  return { state, html };
}

/** Re-export for callers that want the severity tier type. */
export type { FixSeverity };
