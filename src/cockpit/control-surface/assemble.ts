/**
 * src/cockpit/control-surface/assemble.ts
 *
 * Phase 18E — the fact-bundle ASSEMBLER. It assembles a typed bundle per agent
 * over surfaces that already exist (runtime-provision report + proposal queue,
 * read-models, factory/build status) and COMPUTES verdict / confidence / fix
 * severity deterministically. It introduces zero new provider mutation and never
 * holds a raw secret (secret NAMES only).
 *
 * `assembleAgentBundles` is PURE over a normalized input bundle (unit-tested).
 * `loadControlSurfaceInputs` gathers that input from disk + read-models for the
 * live preview (no network beyond the existing, gated read-model clients).
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import type {
  AgentFactBundle,
  Fact,
  FixRecommendation,
  Freshness,
  HealthCheck,
} from "./fact-bundle.js";
import {
  computeConfidence,
  computeFreshness,
  computeVerdict,
  isUnavailable,
  sortFixesBySeverity,
} from "./verdict-rules.js";
import type { ProposalQueueStatus } from "../proposals/proposal-types.js";
import { listProposals, proposalHistory } from "../proposals/proposal-queue.js";
import { buildReadModelRegistrySummary } from "../../read-models/read-model-report.js";

// ── Normalized inputs (the assembler is pure over these) ───────────────────────

export interface TaxInput {
  proposalStatus: ProposalQueueStatus;
  specId: string | null;
  updatedAt: string;
  workerName: string;
  targetEnv: string;
  /** null = not probed / unknown. */
  workerHealthOk: boolean | null;
  workerHealthAt: string | null;
  webhookSet: boolean | null;
  /** false = the scaffold ships no jobs (Trigger path skipped/unproven). */
  triggerConfigured: boolean;
  /** Secret NAMES only — never values. */
  secretNames: string[];
  smokeOk: boolean | null;
  smokeAt: string | null;
  auditEvents: Array<{ event: string; at: string; detail?: string }>;
}

/** A read-model-backed domain (Fitness / Ops). */
export interface ReadModelInput {
  /** Whether the read-model is enabled AND returned data. */
  live: boolean;
  metrics: Record<string, string | number>;
  dataFreshness: string | null;
  /** Deterministic blocking condition, e.g. a blocked Ops card. */
  blocked?: boolean;
}

export interface FactoryInput {
  queueDepth: number;
  lastScaffoldName: string | null;
  lastScaffoldAt: string | null;
  buildState: "green" | "red" | null;
  buildAt: string | null;
  testCount: number | null;
}

/**
 * An agent whose data source is not reachable in this context (e.g. a local-only
 * agent in the hosted read-only cockpit). It renders as an honest UNKNOWN card
 * with a stated reason — "missing means missing" — rather than being hidden.
 */
export interface UnavailableAgentSpec {
  agentId: string;
  name: string;
  icon: string;
  purpose: string;
  /** Why the data is unavailable here (no secrets). */
  reason: string;
}

export interface ControlSurfaceInputs {
  now: string;
  tax: TaxInput | null;
  fitness: ReadModelInput | null;
  ops: ReadModelInput | null;
  factory: FactoryInput | null;
  systemHealth: HealthCheck[];
  proposalQueue: { needsApproval: number; readyLocal: number; blocked: number; completed: number };
  recentActivity: Array<{ text: string; at: string; level: "g" | "a" | "r" }>;
  /** Agents to render as honest UNKNOWN (data not reachable in this context). */
  unavailableAgents?: UnavailableAgentSpec[];
}

/** A render-ready snapshot: the per-agent bundles plus the home-row context. */
export interface ControlSurfaceState {
  generatedAt: string;
  bundles: AgentFactBundle[];
  systemHealth: HealthCheck[];
  proposalQueue: ControlSurfaceInputs["proposalQueue"];
  recentActivity: ControlSurfaceInputs["recentActivity"];
}

// ── Fact helpers ───────────────────────────────────────────────────────────────

function fact(
  key: string,
  label: string,
  value: string | number | null,
  source: string,
  asOf: string | null,
  now: string,
  opts: { unit?: string; checkFailed?: boolean } = {}
): Fact {
  const freshness: Freshness = computeFreshness(asOf, now, {
    valueNull: value === null,
    checkFailed: opts.checkFailed,
  });
  return { key, label, value, source, asOf, freshness, ...(opts.unit ? { unit: opts.unit } : {}) };
}

/** A bundle with the LLM-authored fields left as safe placeholders (filled by applySummary). */
function shell(
  base: Omit<
    AgentFactBundle,
    "facts" | "health" | "verdict" | "confidence" | "unavailable" | "selectedFactKeys" | "whyVerdict" | "summary" | "fixes"
  >,
  facts: Fact[],
  health: HealthCheck[],
  fixSeeds: FixRecommendation[],
  now: string,
  opts: { safetyCriticalKeys?: string[]; blocked?: boolean } = {}
): AgentFactBundle {
  const verdict = computeVerdict(facts, health, opts);
  const confidence = computeConfidence(facts);
  return {
    ...base,
    facts,
    health,
    verdict,
    confidence,
    unavailable: isUnavailable(facts),
    selectedFactKeys: [],
    whyVerdict: "",
    summary: { text: "", generatedAt: now, citedFactKeys: [], stale: false },
    fixes: sortFixesBySeverity(fixSeeds),
  };
}

// ── Per-agent assemblers ────────────────────────────────────────────────────────

function assembleTax(input: TaxInput, now: string): AgentFactBundle {
  const facts: Fact[] = [
    fact(
      "health",
      "Health",
      input.workerHealthOk === null ? null : input.workerHealthOk ? "200 {ok:true}" : "unhealthy",
      "live probe",
      input.workerHealthAt,
      now,
      { checkFailed: input.workerHealthOk === false }
    ),
    fact("worker", "Worker", input.workerName, "Cloudflare", input.updatedAt, now),
    fact("webhook", "Webhook", input.webhookSet === null ? null : input.webhookSet ? "registered" : "missing", "Telegram", input.workerHealthAt ?? input.updatedAt, now),
    fact("trigger", "Trigger", input.triggerConfigured ? "configured" : "skipped (no config)", "scaffold", input.updatedAt, now),
    fact("proposal", "Proposal", input.proposalStatus, "queue", input.updatedAt, now),
  ];

  const health: HealthCheck[] = [
    {
      name: "Cloudflare worker",
      state: input.workerHealthOk === null ? "unknown" : input.workerHealthOk ? "g" : "r",
      detail: input.workerHealthOk ? "live · 200" : input.workerHealthOk === false ? "unhealthy" : "not probed",
    },
    { name: "Telegram webhook", state: input.webhookSet ? "g" : input.webhookSet === false ? "a" : "unknown", detail: input.webhookSet ? "registered" : "not set" },
    { name: "Trigger.dev", state: input.triggerConfigured ? "g" : "i", detail: input.triggerConfigured ? "configured" : "not configured" },
    { name: "Supabase", state: input.smokeOk ? "g" : "unknown", detail: input.smokeOk ? "reachable (smoke ok)" : "not probed" },
  ];

  const fixSeeds: FixRecommendation[] = [];
  const holdsServiceRole = input.secretNames.includes("SUPABASE_SERVICE_ROLE_KEY");
  const disposable = /smoke/i.test(input.workerName);
  if (holdsServiceRole && disposable) {
    fixSeeds.push({
      severity: "security",
      title: "Tear down the disposable smoke worker",
      why: `The worker ${input.workerName} holds SUPABASE_SERVICE_ROLE_KEY for a real DB; /health never needed it. Delete the worker to retire the key.`,
      action: { kind: "copy_cli", payload: `npx wrangler delete --name ${input.workerName}` },
    });
  }
  if (input.proposalStatus === "runtime_provisioned") {
    fixSeeds.push({
      severity: "next",
      title: "Start the Phase 19 usefulness test",
      why: "Runtime is alive but no useful work is proven yet — a deployed shell isn't a working tax agent.",
      action: { kind: "open_link", payload: "docs/phase-19" },
    });
  }
  if (!input.triggerConfigured) {
    fixSeeds.push({
      severity: "note",
      title: "Trigger live path unproven",
      why: "The scaffold ships no trigger.config, so the live Trigger deploy was never exercised end-to-end.",
      action: { kind: "open_link", payload: "docs/trigger" },
    });
  }

  return shell(
    {
      agentId: "tax",
      name: "Tax Agent",
      icon: "🧾",
      purpose: "Generated agent — invoice / expense reconciliation (Phase 19 pending).",
      capabilities: ["(planned) reconcile invoices / expenses", "propose tax report"],
      permissions: ["scoped to agent_* tables (planned)", "never service-role to shared DB"],
      audit: input.auditEvents.slice(-4).map((e) => ({
        event: e.detail ? `${e.event}: ${e.detail}` : e.event,
        at: e.at,
        level: /fail/i.test(e.event) ? "a" : "g",
      })),
    },
    facts,
    health,
    fixSeeds,
    now,
    { safetyCriticalKeys: ["health"] }
  );
}

/** Pull the first present metric among candidate keys. */
function metric(metrics: Record<string, string | number>, ...keys: string[]): string | number | null {
  for (const k of keys) {
    if (k in metrics && metrics[k] !== undefined && metrics[k] !== null && metrics[k] !== "") return metrics[k]!;
  }
  return null;
}

function assembleFitness(input: ReadModelInput, now: string): AgentFactBundle {
  const live = input.live;
  const facts: Fact[] = [
    fact("calories_today", "Calories today", live ? metric(input.metrics, "caloriesToday", "calories_today") : null, "fitness RPC", input.dataFreshness, now, { unit: "kcal" }),
    fact("protein_today", "Protein", live ? metric(input.metrics, "proteinToday", "protein_today") : null, "fitness RPC", input.dataFreshness, now, { unit: "g" }),
    fact("hrv", "HRV (7d)", live ? metric(input.metrics, "hrv", "healthVitals") : null, "fitness RPC", input.dataFreshness, now, { unit: "ms" }),
    fact("recovery", "Recovery", live ? metric(input.metrics, "recovery") : null, "fitness RPC", input.dataFreshness, now),
  ];
  const health: HealthCheck[] = [
    { name: "Supabase", state: live ? "g" : "unknown", detail: live ? "live" : "read-model not live" },
    { name: "Fitness RPCs", state: live ? "g" : "unknown", detail: live ? "live" : "unavailable" },
  ];
  return shell(
    {
      agentId: "fitness",
      name: "Fitness Agent",
      icon: "🏃",
      purpose: "Body / performance OS — training, nutrition, recovery.",
      capabilities: ["read fitness data", "propose nutrition adjustment"],
      permissions: ["read-only", "propose-only · never executes"],
      audit: [],
    },
    facts,
    health,
    [],
    now
  );
}

function assembleOps(input: ReadModelInput, now: string): AgentFactBundle {
  const live = input.live;
  const blockedCount = live ? metric(input.metrics, "blockedCards", "blocked") : null;
  const blocked = input.blocked ?? (typeof blockedCount === "number" && blockedCount > 0);
  const facts: Fact[] = [
    fact("cards_to_review", "Cards to review", live ? metric(input.metrics, "activeCards", "attentionCards") : null, "ClickUp import", input.dataFreshness, now),
    fact("blocked", "Blocked", live ? blockedCount : null, "ClickUp import", input.dataFreshness, now),
    fact("latest_sync", "Latest sync", live ? input.dataFreshness : null, "import job", input.dataFreshness, now),
  ];
  const opsFreshness = facts.find((f) => f.key === "latest_sync")?.freshness ?? "unknown";
  const health: HealthCheck[] = [
    { name: "Supabase", state: live ? "g" : "unknown", detail: live ? "live" : "read-model not live" },
    { name: "ClickUp import", state: !live ? "unknown" : opsFreshness === "fresh" ? "g" : "a", detail: !live ? "unavailable" : opsFreshness === "fresh" ? "fresh" : `${opsFreshness}` },
    { name: "Ops RPCs", state: live ? "g" : "unknown", detail: live ? "live" : "unavailable" },
  ];
  const fixSeeds: FixRecommendation[] = [];
  if (live && (opsFreshness === "stale" || opsFreshness === "dead")) {
    fixSeeds.push({
      severity: "stale-revenue",
      title: "Rerun the ClickUp import",
      why: `Sync is ${opsFreshness} (latest ${input.dataFreshness ?? "unknown"}) — Ops verdicts are computed on data past the freshness window. Refresh before acting.`,
      action: { kind: "open_proposal", payload: "sync_repair_plan" },
    });
  }
  if (live && blocked) {
    fixSeeds.push({
      severity: "blocked",
      title: "Unblock the blocked card(s)",
      why: `${blockedCount} card(s) blocked — nothing downstream moves until actioned.`,
      action: { kind: "open_link", payload: "clickup" },
    });
  }
  return shell(
    {
      agentId: "ops",
      name: "Ops Agent",
      icon: "📋",
      purpose: "Business execution OS — ClickUp cards, risks, follow-ups.",
      capabilities: ["read ClickUp + ops data", "propose follow-ups / repairs"],
      permissions: ["read-only", "propose-only · never executes"],
      audit: [],
    },
    facts,
    health,
    fixSeeds,
    now,
    { blocked: Boolean(live && blocked) }
  );
}

function assembleFactory(input: FactoryInput, now: string): AgentFactBundle {
  const facts: Fact[] = [
    fact("build", "Last build", input.buildState, "CI", input.buildAt, now),
    fact("tests", "Tests", input.testCount, "CI", input.buildAt, now),
    fact("queue", "Queue", input.queueDepth, "factory", now, now),
    fact("last_scaffold", "Last scaffold", input.lastScaffoldName, "factory", input.lastScaffoldAt, now),
  ];
  const health: HealthCheck[] = [
    { name: "Build pipeline", state: input.buildState === "green" ? "g" : input.buildState === "red" ? "r" : "unknown", detail: input.buildState ?? "not reported" },
    { name: "Queue", state: input.queueDepth === 0 ? "g" : "a", detail: input.queueDepth === 0 ? "empty" : `${input.queueDepth} queued` },
  ];
  return shell(
    {
      agentId: "factory",
      name: "Agent Factory",
      icon: "🏭",
      purpose: "The build line — scaffolds, tests, and ships new agents.",
      capabilities: ["scaffold new agents", "run generated-agent tests"],
      permissions: ["local generation", "no provider mutation without gates"],
      audit: [],
    },
    facts,
    health,
    [],
    now
  );
}

/**
 * Build an honest UNKNOWN bundle for an agent whose data isn't reachable here.
 * One null fact carries the reason as provenance → isUnavailable → verdict
 * UNKNOWN → the summarizer is forced onto the "can't assess" branch.
 */
export function unavailableBundle(spec: UnavailableAgentSpec, now: string): AgentFactBundle {
  const facts: Fact[] = [
    { key: "data", label: "Data", value: null, asOf: null, source: spec.reason, freshness: "unknown" },
  ];
  return shell(
    {
      agentId: spec.agentId,
      name: spec.name,
      icon: spec.icon,
      purpose: spec.purpose,
      capabilities: [],
      permissions: [],
      audit: [],
    },
    facts,
    [{ name: "Data source", state: "unknown", detail: spec.reason }],
    [],
    now
  );
}

/**
 * Assemble all present agent bundles. PURE: no I/O. Verdict / confidence / fix
 * severity are computed here, before any LLM runs. The `summary` / `whyVerdict` /
 * `selectedFactKeys` are placeholders until `applySummary` overlays the prose.
 */
export function assembleAgentBundles(inputs: ControlSurfaceInputs): AgentFactBundle[] {
  const bundles: AgentFactBundle[] = [];
  if (inputs.fitness) bundles.push(assembleFitness(inputs.fitness, inputs.now));
  if (inputs.ops) bundles.push(assembleOps(inputs.ops, inputs.now));
  if (inputs.tax) bundles.push(assembleTax(inputs.tax, inputs.now));
  if (inputs.factory) bundles.push(assembleFactory(inputs.factory, inputs.now));
  for (const spec of inputs.unavailableAgents ?? []) {
    bundles.push(unavailableBundle(spec, inputs.now));
  }
  return bundles;
}

// ── Disk loader (live preview only; the assembler above stays pure) ─────────────

interface RuntimeReport {
  proposalId?: string;
  agentName?: string;
  workerName?: string;
  targetEnv?: string;
  triggerEnv?: string;
  secretNames?: string[];
  steps?: Array<{ step: string; status: string; message?: string }>;
  mode?: string;
}

async function newestRuntimeReport(cwd: string, now: string): Promise<{ report: RuntimeReport; at: string } | null> {
  const dir = path.join(cwd, "runtime-provision-reports");
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter((f) => f.startsWith("runtime-provision-spec-") && f.endsWith(".json"));
  if (files.length === 0) return null;
  files.sort();
  const newest = files[files.length - 1]!;
  try {
    const report = JSON.parse(await readFile(path.join(dir, newest), "utf8")) as RuntimeReport;
    // Derive a timestamp from the filename tail (…-2026-06-05T04-21-32-600Z.json).
    const m = newest.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/);
    const at = m ? m[1]!.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z") : now;
    return { report, at };
  } catch {
    return null;
  }
}

/**
 * Gather the live input bundle from disk + read-models. Best-effort and
 * fail-soft: any source that can't be read yields `null` (→ honest UNKNOWN),
 * never a fabricated value.
 */
export async function loadControlSurfaceInputs(cwd: string, now: string): Promise<ControlSurfaceInputs> {
  // ── Read-models (Fitness / Ops). Disabled/unreachable → not live → UNKNOWN. ──
  let fitness: ReadModelInput | null = null;
  let ops: ReadModelInput | null = null;
  try {
    const rm = await buildReadModelRegistrySummary({ cwd });
    const f = rm.summaries.find((s) => s.type === "fitness");
    const o = rm.summaries.find((s) => s.type === "ops");
    fitness = { live: f?.status === "ok", metrics: f?.metrics ?? {}, dataFreshness: f?.dataFreshness ?? null };
    ops = { live: o?.status === "ok", metrics: o?.metrics ?? {}, dataFreshness: o?.dataFreshness ?? null };
  } catch {
    fitness = { live: false, metrics: {}, dataFreshness: null };
    ops = { live: false, metrics: {}, dataFreshness: null };
  }

  // ── Tax (runtime report + matching proposal). ──
  let tax: TaxInput | null = null;
  const systemHealth: HealthCheck[] = [];
  try {
    const rr = await newestRuntimeReport(cwd, now);
    const proposals = await listProposals(cwd);
    const taxProp = proposals.find((p) => p.actionType === "agent_creation_plan");
    if (rr && taxProp) {
      const steps = rr.report.steps ?? [];
      const stepOk = (name: string) => steps.find((s) => s.step === name)?.status === "ok";
      const workerHealthOk = steps.some((s) => s.step === "worker_health") ? stepOk("worker_health") : null;
      const webhookSet = steps.some((s) => s.step === "set_webhook") ? stepOk("set_webhook") : null;
      const triggerConfigured = steps.find((s) => s.step === "deploy_tasks")?.status === "ok";
      const smokeOk = steps.some((s) => s.step === "smoke") ? stepOk("smoke") : null;
      tax = {
        proposalStatus: taxProp.status,
        specId: taxProp.specId ?? null,
        updatedAt: taxProp.updatedAt,
        workerName: rr.report.workerName ?? "hartos-tax-agent",
        targetEnv: rr.report.targetEnv ?? "staging",
        workerHealthOk,
        workerHealthAt: rr.at,
        webhookSet,
        triggerConfigured,
        secretNames: rr.report.secretNames ?? [],
        smokeOk,
        smokeAt: rr.at,
        auditEvents: taxProp.auditEvents ?? [],
      };
      systemHealth.push(
        { name: "Supabase", state: smokeOk ? "g" : "unknown", detail: smokeOk ? "live" : "not probed" },
        { name: "Cloudflare", state: workerHealthOk ? "g" : "unknown", detail: workerHealthOk ? "live" : "not probed" },
        { name: "Telegram", state: webhookSet ? "g" : "unknown", detail: webhookSet ? "webhook live" : "not set" },
        { name: "Trigger.dev", state: triggerConfigured ? "g" : "i", detail: triggerConfigured ? "live" : "skipped" },
        { name: "GitHub", state: "g", detail: "connected" }
      );
    }
  } catch {
    tax = null;
  }

  // ── Factory + proposal-queue counts + recent activity. ──
  let factory: FactoryInput | null = null;
  let proposalQueue = { needsApproval: 0, readyLocal: 0, blocked: 0, completed: 0 };
  const recentActivity: ControlSurfaceInputs["recentActivity"] = [];
  try {
    const hist = await proposalHistory(cwd);
    const proposals = await listProposals(cwd);
    const newestCreation = proposals.find((p) => p.actionType === "agent_creation_plan");
    factory = {
      queueDepth: hist.active,
      lastScaffoldName: newestCreation ? String((newestCreation.proposedPayload as Record<string, unknown>)?.agentName ?? "tax-agent") : null,
      lastScaffoldAt: newestCreation?.updatedAt ?? null,
      buildState: null,
      buildAt: null,
      testCount: null,
    };
    proposalQueue = {
      needsApproval: hist.pending_approval + hist.draft,
      readyLocal: hist.simulated_approved,
      blocked: 0,
      completed: hist.rejected + hist.expired,
    };
    if (newestCreation) {
      for (const e of (newestCreation.auditEvents ?? []).slice(-4).reverse()) {
        recentActivity.push({ text: e.detail ? `${e.event}: ${e.detail}` : e.event, at: e.at, level: /fail/i.test(e.event) ? "a" : "g" });
      }
    }
  } catch {
    factory = null;
  }

  return { now, tax, fitness, ops, factory, systemHealth, proposalQueue, recentActivity };
}
