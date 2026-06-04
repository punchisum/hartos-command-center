/**
 * src/cockpit/cockpit-intent-router.ts
 *
 * Phase 12B — Command HartOS routing upgrade.
 *
 * A DETERMINISTIC, testable router that maps an "Ask HartOS" request to a
 * cockpit intent and produces a GROUNDED answer from the domain panels +
 * available orchestrator context. It never invents operational facts: when
 * context is missing it surfaces the data gaps and the exact next setup steps.
 *
 * LLM enhancement (in the bridge) is optional/gated; this deterministic router
 * is the fallback and the source of the intent classification + grounded
 * summary. It does not mutate or execute anything.
 *
 * Separation of concerns:
 *   - Product logic / state machine  → this file (intent detection + answer)
 *   - Runtime architecture           → cockpit-orchestrator-bridge.ts (wiring)
 *   - Implementation patch           → cockpit-renderer.ts (rendering)
 */

import type { DomainPanel, PanelField } from "./panels/index.js";
import { BUILD_AGENT_EXAMPLES } from "./panels/index.js";
import type { CockpitSystemSummary } from "./cockpit-types.js";
import type { ActionProposal, ProposalQueueItem } from "./proposals/index.js";
import { generateProposals, type GateEnv } from "./proposals/index.js";
import type { SourceDiagnosticsReport } from "./sources/index.js";
import { buildFreshnessReport, type FreshnessReport } from "./freshness-surface.js";

export type CockpitIntent =
  | "system_status"
  | "fitness_status"
  | "ops_status"
  | "freshness_status"
  | "build_agent"
  | "improve_agent"
  | "strategy_review"
  | "read_model_status"
  | "proposal_list"
  | "proposal_reject"
  | "proposal_dryrun"
  | "proposal_reject_all_fitness"
  | "proposal_expire_duplicates"
  | "proposal_history"
  | "unknown";

/** Parsed reference to a queued proposal (1-based number or full id). */
export interface ParsedProposalRef {
  number?: number;
  id?: string;
}

/** Extract a proposal reference (`prop-...` id or a number) from a request. */
export function parseProposalRef(request: string): ParsedProposalRef {
  const idMatch = request.match(/\bprop-[a-z0-9-]+/i);
  if (idMatch) return { id: idMatch[0] };
  const numMatch = request.match(/\b(\d{1,4})\b/);
  if (numMatch) return { number: Number(numMatch[1]) };
  return {};
}

/** Orchestrator-derived context (already deterministic), when available. */
export interface IntentOrchestratorContext {
  classification: string;
  domain: string;
  strategyReview: string | null;
  ctoReview: string | null;
  buildPlanSummary: string;
  capabilityGaps: string;
  nextRecommendedCommand: string;
}

export interface IntentIntegrationContext {
  configPresent: boolean;
  agentsConfigured: number;
  agentsDetected: number;
  readModelsEnabled: number;
}

export interface IntentRouterContext {
  request: string;
  panels: DomainPanel[];
  systemSummary: CockpitSystemSummary;
  integration?: IntentIntegrationContext;
  llm?: { provider: string | null; mode: string | null };
  orchestrator?: IntentOrchestratorContext;
  /** Phase 14A — when provided, the router attaches proposal drafts. */
  now?: string;
  env?: GateEnv;
  /** Phase 13.5E — read-model source diagnostics for the data-diagnostics intent. */
  diagnostics?: SourceDiagnosticsReport;
  /** Phase 14B — persisted proposal queue for the proposal-list intent. */
  proposalQueue?: ProposalQueueItem[];
}

export interface CockpitIntentResult {
  intent: CockpitIntent;
  title: string;
  /** Grounded, human-readable answer. */
  summary: string;
  highlights: string[];
  gaps: string[];
  nextSteps: string[];
  /** Suggested commands (always populated for `unknown`). */
  suggestedCommands: string[];
  /** A useful clarifying question for `unknown`, else null. */
  clarifyingQuestion: string | null;
  /** True when this intent benefits from the full Orchestrator build pipeline. */
  usesOrchestrator: boolean;
  matchedKeywords: string[];
  /** Phase 14A — non-executable proposal drafts (empty for status-only intents). */
  proposals: ActionProposal[];
}

// ─── Detection ───────────────────────────────────────────────────────────────

function has(text: string, ...needles: string[]): string[] {
  return needles.filter((n) => text.includes(n));
}

const STATUS_AGENT = ["agent", "fitness", "ops", "operations", "tax", "invoice", "finance"];

/** Deterministic intent detection. Order matters (build/improve before status). */
export function detectCockpitIntent(request: string): { intent: CockpitIntent; matchedKeywords: string[] } {
  const t = request.toLowerCase().trim();

  // 0a. Proposal queue HYGIENE commands (Phase 14B cleanup) — must beat the
  // generic reject/list rules below.
  if (has(t, "reject all").length && has(t, "fitness").length && has(t, "proposal").length) {
    return { intent: "proposal_reject_all_fitness", matchedKeywords: ["reject all", "fitness", "proposal"] };
  }
  let m = has(t, "expire duplicate proposals", "expire duplicates");
  if (m.length || (has(t, "expire").length && has(t, "duplicate").length)) {
    return { intent: "proposal_expire_duplicates", matchedKeywords: m.length ? m : ["expire", "duplicate"] };
  }
  m = has(t, "proposal history", "show proposal history", "history of proposals");
  if (m.length || (has(t, "history").length && has(t, "proposal").length)) {
    return { intent: "proposal_history", matchedKeywords: m.length ? m : ["history", "proposal"] };
  }

  // 0a (cont). Proposal queue commands (explicit "proposal").
  m = has(t, "reject proposal", "reject the proposal");
  if (m.length || (has(t, "reject").length && has(t, "proposal").length)) return { intent: "proposal_reject", matchedKeywords: m.length ? m : ["reject", "proposal"] };
  m = has(t, "dry run proposal", "dry-run proposal", "dryrun proposal", "simulate proposal", "dry run the proposal");
  if (m.length || ((has(t, "dry run", "dry-run", "dryrun", "simulate").length) && has(t, "proposal").length)) return { intent: "proposal_dryrun", matchedKeywords: m.length ? m : ["dry-run", "proposal"] };
  m = has(t, "pending proposals", "show proposals", "list proposals", "show pending proposals", "proposal queue", "saved proposals", "my proposals");
  if (m.length) return { intent: "proposal_list", matchedKeywords: m };

  // 0a.7 Freshness / sync control (explicit) — before read-model + ops/fitness so
  // "is my data fresh?", "what needs refreshing?", and "why is ops stale?" land here.
  m = has(
    t,
    "what needs refreshing", "needs refreshing", "need refreshing", "needs a refresh", "what should i refresh",
    "refresh plan", "sync repair", "sync plan", "repair plan", "refresh ops", "refresh the data",
    "is my data fresh", "is data fresh", "is the data fresh", "are we fresh", "data fresh",
    "data freshness", "freshness", "freshness status", "sync status", "sync health", "fix stale"
  );
  if (m.length) return { intent: "freshness_status", matchedKeywords: m };
  if (has(t, "why").length && has(t, "stale").length) return { intent: "freshness_status", matchedKeywords: ["why", "stale"] };
  if (has(t, "stale").length && has(t, "fix", "refresh", "repair").length) return { intent: "freshness_status", matchedKeywords: ["stale", "fix"] };
  if (has(t, "refresh").length && has(t, "ops", "fitness", "factory", "data", "system", "sync", "everything").length) {
    return { intent: "freshness_status", matchedKeywords: ["refresh", ...has(t, "ops", "fitness", "factory", "data", "system", "sync")] };
  }

  // 0b. Read-model / source diagnostics (explicit) — must beat fitness/ops status.
  m = has(t, "read model status", "read-model status", "read model", "read-model", "sources connected", "sources are connected", "what sources", "which sources", "connected sources", "data is stale", "what data is stale", "what's stale", "whats stale", "stale data", "data stale", "source status");
  if (m.length) return { intent: "read_model_status", matchedKeywords: m };
  if (has(t, "why is my", "why's my", "why are my").length && has(t, "panel", "missing data", "no data", "missing", "fitness", "ops").length) {
    return { intent: "read_model_status", matchedKeywords: ["why is my", "panel"] };
  }

  // 1. System status (explicit).
  m = has(t, "system status", "show system status", "how is hartos", "how's hartos", "how is hart os", "status of hartos", "overall status", "how is the system");
  if (m.length) return { intent: "system_status", matchedKeywords: m };

  // 2. Strategy / Prophet style (explicit, before status so "what am I missing" wins).
  m = has(t, "highest leverage", "high leverage", "leverage", "what am i missing", "what's missing", "what is missing", "cto review", "give me a cto", "strategy review", "blind spot", "next best move", "biggest opportunity");
  if (m.length) return { intent: "strategy_review", matchedKeywords: m };

  // 3. Improve an existing agent (before fitness/ops status, since it mentions them).
  const improveWords = has(t, "improve", "make better", "upgrade", "enhance", "level up");
  if (improveWords.length && has(t, ...STATUS_AGENT).length) {
    return { intent: "improve_agent", matchedKeywords: [...improveWords, ...has(t, ...STATUS_AGENT)] };
  }

  // 4. Build / new agent.
  m = has(t, "what should i build", "what to build", "build next", "what next");
  if (m.length) return { intent: "build_agent", matchedKeywords: m };
  const buildWords = has(t, "build", "create", "make", "new", "spin up", "scaffold");
  if (buildWords.length && has(t, "agent").length) {
    return { intent: "build_agent", matchedKeywords: [...buildWords, "agent"] };
  }
  // "create a tax/invoice <thing>" without the word agent.
  if (has(t, "create", "build").length && has(t, "tax", "invoice", "receipt", "expense", "specialist").length) {
    return { intent: "build_agent", matchedKeywords: has(t, "create", "build", "tax", "invoice", "receipt", "expense", "specialist") };
  }

  // 5. Ops status.
  m = has(t, "ops", "operations", "urgent", "blocked card", "blocked", "clickup", "ops update", "ops updates", "what changed in ops", "risk card", "at risk");
  if (m.length) return { intent: "ops_status", matchedKeywords: m };

  // 6. Fitness status.
  m = has(t, "fitness", "training", "recovery", "calories", "protein", "workout", "hrv", "rhr", "sleep", "how's recovery", "how is recovery", "macros", "nutrition");
  if (m.length) return { intent: "fitness_status", matchedKeywords: m };

  return { intent: "unknown", matchedKeywords: [] };
}

// ─── Grounded answer helpers ─────────────────────────────────────────────────

function panelById(panels: DomainPanel[], id: DomainPanel["id"]): DomainPanel | undefined {
  return panels.find((p) => p.id === id);
}

function field(panel: DomainPanel | undefined, key: string): PanelField | undefined {
  return panel?.fields.find((f) => f.key === key);
}

function topN<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

const SUGGESTED_COMMANDS = [
  "What's my system status?",
  "How is my fitness agent today?",
  "Show read model status",
  "Is my data fresh?",
  "What needs refreshing?",
  "Why is my fitness panel missing data?",
  "Anything urgent in ops?",
  "What should I build next?",
  "Create a tax agent",
  "Improve the fitness agent",
  "Show pending proposals",
  "Dry run proposal 1",
  "Reject proposal 1",
  "Give me a CTO review",
];

// ─── Freshness helpers (Phase 15C) ───────────────────────────────────────────

/** Build the freshness/sync report from the routing context (pure, read-only). */
function freshnessFromCtx(ctx: IntentRouterContext): FreshnessReport {
  const now = ctx.now ?? ctx.diagnostics?.generatedAt ?? ctx.panels[0]?.generatedAt ?? "";
  return buildFreshnessReport({
    panels: ctx.panels,
    now,
    ...(ctx.diagnostics ? { diagnostics: ctx.diagnostics } : {}),
  });
}

/** One-line freshness verdict suitable for embedding in other status answers. */
function freshnessVerdictLine(r: FreshnessReport): string {
  return `Data freshness: ${r.verdict.toUpperCase()} — ${r.verdictReason}`;
}

// ─── Per-intent answer builders ──────────────────────────────────────────────

function answerSystemStatus(ctx: IntentRouterContext): CockpitIntentResult {
  const fitness = panelById(ctx.panels, "fitness");
  const ops = panelById(ctx.panels, "ops");
  const factory = panelById(ctx.panels, "factory");
  const s = ctx.systemSummary;
  const integ = ctx.integration;
  const llm = ctx.llm?.provider ? `${ctx.llm.provider}/${ctx.llm.mode}` : "deterministic fallback";
  const fr = freshnessFromCtx(ctx);

  const lines = [
    `Cockpit: ${s.cardCount} cards, ${s.missingSourceCount} missing source(s), ${s.reportCount} local report(s).`,
    freshnessVerdictLine(fr),
    `Factory: ${factory?.status ?? "unknown"} — ${factory?.highlights[0] ?? "modules present"}.`,
    `Ops Agent: ${ops?.status ?? "unconfigured"}${ops?.highlights.length ? ` — ${ops.highlights[0]}` : ""}.`,
    `Fitness Agent: ${fitness?.status ?? "unconfigured"}${fitness?.highlights.length ? ` — ${fitness.highlights[0]}` : ""}.`,
    `LLM gateway: ${llm}.`,
    integ ? `Read-models: ${integ.readModelsEnabled} enabled; agents ${integ.agentsDetected}/${integ.agentsConfigured} detected/configured (config ${integ.configPresent ? "present" : "absent"}).` : `Read-models: see Fitness/Ops panels.`,
  ];
  if (fr.staleReason) lines.push(`Freshness note: ${fr.staleReason}`);

  const highlights: string[] = [`Freshness: ${fr.verdict.toUpperCase()}.`];
  if (factory?.status === "available") highlights.push("Factory is available locally.");
  for (const p of [ops, fitness]) for (const h of p?.highlights ?? []) highlights.push(`${p!.title}: ${h}`);

  const gaps: string[] = [];
  if (fr.staleDomains.length) gaps.push(`Stale: ${fr.staleDomains.join(", ")}.`);
  if (s.missingSourceCount > 0) gaps.push(`${s.missingSourceCount} missing command-center source(s).`);
  for (const p of [fitness, ops, factory]) for (const g of topN(p?.missingSetupSteps ?? [], 1)) gaps.push(`${p!.title}: ${g}`);

  const nextSteps = uniqueNonEmpty([
    fr.verdict !== "green" ? fr.safeNextStep : undefined,
    ...[fitness, ops, factory].map((p) => p?.nextAction),
    s.nextRecommendedCommand,
  ]);

  return base("system_status", "System status", lines.join("\n"), highlights, gaps, nextSteps, false);
}

function answerFitness(ctx: IntentRouterContext): CockpitIntentResult {
  const p = panelById(ctx.panels, "fitness");
  if (!p) return panelMissing("fitness_status", "Fitness status", "fitness");
  const recovery = field(p, "recovery");
  const plan = field(p, "training_plan");
  const calories = field(p, "calories");
  const protein = field(p, "protein");
  const adjustment = field(p, "adjustment");

  const lines = [
    p.summary,
    `Recovery: ${recovery?.value ?? "unknown"}.`,
    `Today's plan: ${plan?.value ?? "unknown"}; completed: ${field(p, "training_completed")?.value ?? "unknown"}.`,
    `Nutrition — calories: ${calories?.value ?? "unknown"}, protein: ${protein?.value ?? "unknown"}.`,
    `Next adjustment: ${adjustment?.value ?? "unknown"}.`,
  ];
  const nextSteps = uniqueNonEmpty([p.nextAction, ...topN(p.missingSetupSteps, 3)]);
  return base("fitness_status", "Fitness status", lines.join("\n"), p.highlights, topN(p.gaps, 5), nextSteps, false);
}

/** Ops verdict — operator traffic-light. */
export type OpsVerdict = "green" | "amber" | "red";

/** Pure, testable ops verdict from the resolved attention signals. */
export function computeOpsVerdict(signals: {
  urgent: number;
  blocked: number;
  waiting: number;
  stale: number;
  noNextAction: number;
  clickupStale: boolean;
}): OpsVerdict {
  if (signals.urgent > 0 || signals.blocked > 0) return "red";
  if (signals.waiting > 0 || signals.stale > 0 || signals.noNextAction > 0 || signals.clickupStale) return "amber";
  return "green";
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function joinClauses(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function answerOps(ctx: IntentRouterContext): CockpitIntentResult {
  const p = panelById(ctx.panels, "ops");
  if (!p) return panelMissing("ops_status", "Ops status", "ops");

  // ── Grounded facts (only count fields that resolved to a real value) ──
  const numFromField = (key: string): number | null => {
    const f = field(p, key);
    if (!f || f.status !== "ok") return null;
    const n = Number(f.value);
    return Number.isFinite(n) ? n : null;
  };
  const n0 = (key: string): number => numFromField(key) ?? 0;

  const active = numFromField("active_cards");
  const urgent = n0("urgent");
  const blocked = n0("blocked");
  const waiting = n0("waiting");
  const stale = n0("stale");
  const noNextAction = n0("no_next_action");

  // ClickUp sync staleness is REAL when any resolved live ops field is stale
  // (the read-model's data_freshness — latest card activity — is > the window).
  // We never fake freshness: this is surfaced as an honest operator warning.
  const STALE_PROBE_FIELDS = ["active_cards", "urgent", "blocked", "waiting", "stale", "clickup_sync", "latest_updates"];
  const clickupStale = STALE_PROBE_FIELDS.some((k) => field(p, k)?.freshness === "stale");

  const riskFlags = field(p, "risk_flags");
  const updates = field(p, "latest_updates");
  const sync = field(p, "clickup_sync");
  const pendingApprovals = field(p, "pending_approvals");
  const ddReports = field(p, "dd_reports");

  const verdict = computeOpsVerdict({ urgent, blocked, waiting, stale, noNextAction, clickupStale });

  // ── One-sentence verdict reason + the single main action ──
  let verdictLine: string;
  let mainAction: string;
  if (verdict === "red") {
    const redParts: string[] = [];
    if (urgent > 0) redParts.push(`${urgent} urgent ${plural(urgent, "card")}`);
    if (blocked > 0) redParts.push(`${blocked} blocked/at-risk ${plural(blocked, "card")}`);
    verdictLine = `Ops is red. ${joinClauses(redParts)} ${redParts.length > 1 ? "need" : "needs"} attention now.`;
    mainAction =
      blocked > 0
        ? `Triage the ${blocked} blocked/at-risk ${plural(blocked, "card")} first.`
        : `Action the ${urgent} urgent ${plural(urgent, "card")}.`;
  } else if (verdict === "amber") {
    const amberParts: string[] = [];
    if (waiting > 0) amberParts.push(`${waiting} ${plural(waiting, "card")} waiting on Hart`);
    if (stale > 0) amberParts.push(`${stale} stale ${plural(stale, "card")}`);
    if (noNextAction > 0) amberParts.push(`${noNextAction} ${plural(noNextAction, "card")} without a next action`);
    if (clickupStale) amberParts.push("the ClickUp sync appears stale");
    verdictLine = `Ops is amber. No urgent or blocked cards, but ${joinClauses(amberParts)}.`;
    mainAction =
      waiting > 0
        ? `Unblock the ${waiting} ${plural(waiting, "card")} waiting on Hart.`
        : stale > 0
          ? `Review the ${stale} stale ${plural(stale, "card")}.`
          : noNextAction > 0
            ? `Assign a next action to ${noNextAction} ${plural(noNextAction, "card")}.`
            : "Re-run the ClickUp import to refresh the ops view.";
  } else {
    verdictLine = "Ops is green. No urgent, blocked, stale, or waiting cards, and the ClickUp sync looks current.";
    mainAction = "Nothing needs your attention right now — keep monitoring.";
  }

  // ── Executive summary, grounded facts kept underneath the verdict ──
  const factsParts = [
    active != null ? `${active} active` : null,
    `${urgent} urgent`,
    `${blocked} blocked/risk`,
    `${waiting} waiting on Hart`,
    `${stale} stale`,
    `${noNextAction} without a next action`,
  ].filter((x): x is string => !!x);

  // Source values may already end with a period; avoid a doubled ".." .
  const endDot = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
  const lines = [
    verdictLine,
    `Main action: ${mainAction}`,
    `Cards: ${factsParts.join(", ")}.`,
    `Latest update: ${endDot(updates?.status === "ok" ? updates.value : "none available")}`,
    `ClickUp sync: ${endDot(sync?.status === "ok" ? sync.value : "unknown")}${
      clickupStale ? " STALE: latest card activity is older than the freshness window; re-run the ClickUp import." : ""
    }`,
    riskFlags?.status === "ok" ? `Risk flags: ${endDot(riskFlags.value)}` : null,
  ].filter((x): x is string => !!x);

  // ── Stale-specific guidance (Phase 15C) — preserve the structure above ──
  if (clickupStale) {
    const staleSince =
      sync?.lastUpdated ?? updates?.lastUpdated ?? field(p, "active_cards")?.lastUpdated ?? null;
    lines.push(
      `Caution: ops data is stale${staleSince ? ` (last ClickUp activity ${staleSince})` : ""} — don't make important operational decisions from it.`
    );
    lines.push("To refresh: re-run the ClickUp import manually, then re-check ops status (HartOS will not run the import for you).");
  }

  // ── Highlights: lead with the verdict, then real card signals ──
  const highlights = uniqueNonEmpty([`Verdict: ${verdict.toUpperCase()}.`, ...p.highlights]);

  // ── Honest, operator-phrased gaps (do not invent missing data) ──
  const gaps: string[] = [];
  if (clickupStale) gaps.push("ClickUp sync stale — operator view may be out of date.");
  if (pendingApprovals?.status !== "ok") gaps.push("Pending approvals source is not wired yet.");
  if (ddReports?.status !== "ok") gaps.push("DD/analyse report source is not wired yet.");
  for (const g of p.gaps) {
    if (/missing source/i.test(g) && !gaps.includes(g)) gaps.push(g);
  }

  const nextSteps = uniqueNonEmpty(topN(p.missingSetupSteps, 3));
  return base("ops_status", "Ops status", lines.join("\n"), highlights, topN(gaps, 5), nextSteps, false);
}

function answerBuild(ctx: IntentRouterContext): CockpitIntentResult {
  const factory = panelById(ctx.panels, "factory");
  const o = ctx.orchestrator;
  const suggested = field(factory, "suggested_build")?.value;
  const lines = [
    o ? `Request classified as ${o.classification} (domain: ${o.domain}).` : "Build request.",
    o ? `Build plan: ${o.buildPlanSummary}. Capability gaps: ${o.capabilityGaps}.` : "Run Ask HartOS with the Orchestrator for a full build plan.",
    factory ? `Factory: ${factory.status}; ${field(factory, "capabilities")?.value ?? "no capabilities registered"}.` : "",
    suggested ? `Suggested next build: ${suggested}` : "",
  ].filter(Boolean);

  const highlights = uniqueNonEmpty([
    suggested,
    field(factory, "modules")?.value ? `Modules: ${field(factory, "modules")!.value}` : undefined,
  ]);
  const gaps = uniqueNonEmpty([
    o?.capabilityGaps,
    ...topN(factory?.missingSetupSteps ?? [], 2),
  ]);
  const nextSteps = uniqueNonEmpty([
    o?.nextRecommendedCommand,
    'npm run hartos:build-plan -- --request="<your request>"',
    `Entry prompts: ${BUILD_AGENT_EXAMPLES.join(" | ")}`,
  ]);
  return base("build_agent", "Build / new agent", lines.join("\n"), highlights, gaps, nextSteps, true);
}

function answerImprove(ctx: IntentRouterContext): CockpitIntentResult {
  const t = ctx.request.toLowerCase();
  const targetId = t.includes("ops") || t.includes("operation") ? "ops" : t.includes("fitness") || t.includes("training") || t.includes("recovery") ? "fitness" : null;
  const targets: DomainPanel[] = targetId
    ? ctx.panels.filter((p) => p.id === targetId)
    : ctx.panels.filter((p) => p.id === "fitness" || p.id === "ops");

  const lines: string[] = [];
  const highlights: string[] = [];
  const gaps: string[] = [];
  const nextSteps: string[] = [];
  for (const p of targets) {
    lines.push(`${p.title}: ${p.status}. ${p.summary}`);
    if (p.missingSetupSteps.length === 0) {
      lines.push(`${p.title} is fully set up — improvement is incremental (review ${p.nextAction}).`);
    }
    for (const h of p.highlights) highlights.push(`${p.title}: ${h}`);
    for (const g of topN(p.missingSetupSteps, 3)) { gaps.push(`${p.title}: ${g}`); nextSteps.push(g); }
    nextSteps.push(p.nextAction);
  }
  if (ctx.orchestrator) {
    lines.push(`Orchestrator: ${ctx.orchestrator.classification}; build plan: ${ctx.orchestrator.buildPlanSummary}.`);
    nextSteps.push(ctx.orchestrator.nextRecommendedCommand);
  }
  const summary = lines.length ? lines.join("\n") : "No improvable agent detected — configure agent-integrations.local.json first.";
  return base("improve_agent", "Improve agent", summary, highlights, gaps, uniqueNonEmpty(nextSteps), true);
}

function answerStrategy(ctx: IntentRouterContext): CockpitIntentResult {
  const o = ctx.orchestrator;
  const factory = panelById(ctx.panels, "factory");
  const suggested = field(factory, "suggested_build")?.value ?? factory?.nextAction;
  const s = ctx.systemSummary;

  const lines = [
    o?.strategyReview ? `Strategy verdict: ${o.strategyReview}` : "Strategy review: run via Ask HartOS for a verdict.",
    o?.ctoReview ? `CTO review: ${o.ctoReview}` : "CTO review: not run for this request.",
    `Highest-leverage move (grounded in current config): ${suggested ?? "configure data sources to unlock leverage"}.`,
    `Open gaps: ${s.missingSourceCount} missing source(s) across the cockpit.`,
  ];
  const highlights = uniqueNonEmpty([o?.strategyReview ?? undefined, o?.ctoReview ?? undefined, suggested]);
  const gaps: string[] = [];
  for (const p of ctx.panels) for (const g of topN(p.missingSetupSteps, 1)) gaps.push(`${p.title}: ${g}`);
  if (s.missingSourceCount > 0) gaps.push(`${s.missingSourceCount} missing command-center source(s).`);
  const nextSteps = uniqueNonEmpty([
    suggested,
    o?.nextRecommendedCommand,
    'npm run hartos:strategy-review -- --request="<your decision>"',
  ]);
  return base("strategy_review", "Strategy / CTO review", lines.join("\n"), highlights, gaps, nextSteps, true);
}

function answerReadModelStatus(ctx: IntentRouterContext): CockpitIntentResult {
  const d = ctx.diagnostics;
  if (!d) {
    return base("read_model_status", "Read-model status", "Read-model diagnostics are unavailable in this context. Run `npm run read-models:status`.", [], ["diagnostics unavailable"], ["npm run read-models:status"], false);
  }
  const t = ctx.request.toLowerCase();
  const focus = t.includes("fitness") ? "fitness" : t.includes("ops") || t.includes("operation") ? "ops" : t.includes("factory") || t.includes("build") ? "factory" : null;
  const domains = focus ? d.domains.filter((x) => x.domain === focus) : d.domains;
  const fr = freshnessFromCtx(ctx);

  const lines = [
    freshnessVerdictLine(fr),
    `Read-model config: ${d.configPresent ? `present (${d.configPath})` : "absent"}.`,
    `Configured: ${d.configuredSources.join(", ") || "none"}. Enabled: ${d.enabledSources.join(", ") || "none"}. Disabled: ${d.disabledSources.join(", ") || "none"}.`,
    `Missing env: ${d.missingSources.join(", ") || "none"}. Stale: ${d.staleSources.join(", ") || "none"}. Rejected (unsafe): ${d.rejectedSources.join(", ") || "none"}.`,
    `Latest read-model check: ${fr.generatedAt || "unknown"}.`,
  ];
  for (const dom of domains) {
    lines.push(`${dom.domain}: ${dom.status} (${dom.resolvedFields} field(s), freshness=${dom.freshness}) — ${dom.note}`);
  }
  if (fr.staleReason) lines.push(`Why stale: ${fr.staleReason}`);

  const highlights: string[] = [`Freshness: ${fr.verdict.toUpperCase()}.`];
  if (d.rejectedSources.length) highlights.push(`Rejected unsafe key(s) for: ${d.rejectedSources.join(", ")} — use a read-only anon key.`);
  if (d.staleSources.length) highlights.push(`Stale data for: ${d.staleSources.join(", ")}.`);
  const gaps = domains.filter((x) => x.status !== "live").map((x) => `${x.domain}: ${x.status}`);
  const nextSteps = uniqueNonEmpty([fr.verdict !== "green" ? fr.safeNextStep : undefined, ...domains.map((x) => x.setupStep)]);
  return base("read_model_status", "Read-model status", lines.join("\n"), highlights, gaps, nextSteps, false);
}

/** Phase 15C — dedicated freshness / sync control answer. */
function answerFreshness(ctx: IntentRouterContext): CockpitIntentResult {
  const r = freshnessFromCtx(ctx);
  const domainLine = (dom: typeof r.domains[number]): string =>
    `- ${dom.domain[0]!.toUpperCase()}${dom.domain.slice(1)}: ${dom.state}${dom.lastUpdated ? ` (updated ${dom.lastUpdated})` : ""} — ${dom.reason}`;

  const lines: string[] = [
    `System freshness: ${r.verdict.toUpperCase()}. ${r.verdictReason}`,
    ...r.domains.map(domainLine),
  ];
  if (r.staleReason) lines.push(`Why: ${r.staleReason}`);
  // ClickUp import / sync health.
  lines.push(
    `ClickUp sync: ${r.clickup.stale ? "STALE" : "current"}; last import/activity ${r.clickup.lastImportAt ?? "unknown"}${
      r.clickup.cardsImported ? `, ${r.clickup.cardsImported} cards imported` : ""
    }${r.clickup.importStatus ? `, status: ${r.clickup.importStatus}` : ""}.`
  );
  lines.push(`What to verify next: confirm the import job ran (check the timestamp above), then re-run \`npm run read-models:status\`.`);
  lines.push(`Safe to do manually: ${r.safeNextStep}`);
  lines.push("Not executable: HartOS will NOT run the ClickUp import or any sync for you — there is no execution path. It can only draft a refresh plan on request.");
  if (r.clickup.stale) lines.push("Caution: ops data is stale — do not make important operational decisions from it until refreshed.");

  const highlights = uniqueNonEmpty([
    `Freshness: ${r.verdict.toUpperCase()}.`,
    r.staleDomains.length ? `Stale: ${r.staleDomains.join(", ")}.` : undefined,
    r.unavailableDomains.length ? `Unavailable: ${r.unavailableDomains.join(", ")}.` : undefined,
  ]);
  const gaps = uniqueNonEmpty(r.domains.filter((dom) => dom.state !== "fresh").map((dom) => `${dom.domain}: ${dom.state} — ${dom.reason}`));
  const nextSteps = uniqueNonEmpty([r.safeNextStep, "npm run read-models:status", ...r.domains.map((dom) => dom.safeNextStep)]);
  return base("freshness_status", "Freshness / sync", lines.join("\n"), highlights, gaps, nextSteps, false);
}

function answerProposalList(ctx: IntentRouterContext): CockpitIntentResult {
  const q = ctx.proposalQueue ?? [];
  if (q.length === 0) {
    return base("proposal_list", "Proposal queue", "No saved proposals yet. A build/improve/ops/fitness Ask HartOS request creates non-executable proposal drafts in the local queue.", [], [], ["Try: Create a tax agent", "Try: Improve the fitness agent"], false);
  }
  const lines = q.map((p, i) => `${i + 1}. [${p.domain}/${p.riskLevel}] ${p.title} — ${p.status} (id ${p.id})`);
  const pending = q.filter((p) => p.status === "draft" || p.status === "pending_approval").length;
  const highlights = [`${q.length} proposal(s); ${pending} pending. All NON-EXECUTABLE / DRY-RUN ONLY.`];
  return base("proposal_list", "Proposal queue", lines.join("\n"), highlights, [], ["Dry run proposal <n>", "Reject proposal <n>"], false);
}

function answerProposalRef(intent: CockpitIntent, title: string, verb: string): CockpitIntentResult {
  // The bridge performs the local queue mutation and overrides this summary.
  return base(intent, title, `${verb} (applied to the local proposal queue only — no execution).`, [], [], ["Show pending proposals"], false);
}

/** Phase 14B cleanup — read-only status roll-up of the local proposal queue. */
function answerProposalHistory(ctx: IntentRouterContext): CockpitIntentResult {
  const q = ctx.proposalQueue ?? [];
  const n = (s: ProposalQueueItem["status"]) => q.filter((p) => p.status === s).length;
  const draft = n("draft");
  const pendingApproval = n("pending_approval");
  const pending = draft + pendingApproval;
  const rejected = n("rejected");
  const simulated = n("simulated_approved");
  const expired = n("expired");
  const summary = [
    `Proposal history (local queue only, NON-EXECUTABLE): ${q.length} total.`,
    `Pending: ${pending} (draft ${draft}, pending-approval ${pendingApproval}). Rejected: ${rejected}. Simulated-approved: ${simulated}. Expired: ${expired}.`,
  ].join("\n");
  const active = q.filter((p) => p.status === "draft" || p.status === "pending_approval").slice(0, 5);
  const highlights = active.map((p) => `[${p.domain}/${p.riskLevel}] ${p.title} — ${p.status}`);
  return base("proposal_history", "Proposal history", summary, highlights, [], ["Reject all draft fitness proposals", "Expire duplicate proposals"], false);
}

function answerUnknown(_ctx: IntentRouterContext): CockpitIntentResult {
  return {
    intent: "unknown",
    title: "Need a bit more",
    summary: "I couldn't map that to a known command. Try one of the suggested commands, or tell me whether you want system status, a domain update (fitness/ops), or a build/strategy decision.",
    highlights: [],
    gaps: [],
    nextSteps: [],
    suggestedCommands: SUGGESTED_COMMANDS,
    clarifyingQuestion: "Do you want a status check (system/fitness/ops), a build plan, or a strategy/CTO review?",
    usesOrchestrator: false,
    matchedKeywords: [],
    proposals: [],
  };
}

// ─── Shared result constructors ──────────────────────────────────────────────

function base(
  intent: CockpitIntent,
  title: string,
  summary: string,
  highlights: string[],
  gaps: string[],
  nextSteps: string[],
  usesOrchestrator: boolean
): CockpitIntentResult {
  return {
    intent,
    title,
    summary,
    highlights,
    gaps,
    nextSteps,
    suggestedCommands: [],
    clarifyingQuestion: null,
    usesOrchestrator,
    matchedKeywords: [],
    proposals: [],
  };
}

function panelMissing(intent: CockpitIntent, title: string, name: string): CockpitIntentResult {
  return base(
    intent,
    title,
    `No ${name} panel was available. Configure agent-integrations.local.json (and optionally a ${name} read-model) to surface ${name} status.`,
    [],
    [`${name} panel unavailable`],
    [`Configure the ${name} agent in agent-integrations.local.json, then run npm run agents:status.`],
    false
  );
}

function uniqueNonEmpty(items: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (i && !out.includes(i)) out.push(i);
  }
  return out;
}

// ─── Public entry point ──────────────────────────────────────────────────────

/** Route a request to a cockpit intent and produce a grounded answer. */
export function routeCockpitIntent(ctx: IntentRouterContext): CockpitIntentResult {
  const { intent, matchedKeywords } = detectCockpitIntent(ctx.request);
  let result: CockpitIntentResult;
  switch (intent) {
    case "system_status": result = answerSystemStatus(ctx); break;
    case "fitness_status": result = answerFitness(ctx); break;
    case "ops_status": result = answerOps(ctx); break;
    case "freshness_status": result = answerFreshness(ctx); break;
    case "build_agent": result = answerBuild(ctx); break;
    case "improve_agent": result = answerImprove(ctx); break;
    case "strategy_review": result = answerStrategy(ctx); break;
    case "read_model_status": result = answerReadModelStatus(ctx); break;
    case "proposal_list": result = answerProposalList(ctx); break;
    case "proposal_reject": result = answerProposalRef("proposal_reject", "Reject proposal", "Proposal rejection"); break;
    case "proposal_dryrun": result = answerProposalRef("proposal_dryrun", "Dry-run proposal", "Proposal dry-run"); break;
    case "proposal_reject_all_fitness": result = answerProposalRef("proposal_reject_all_fitness", "Reject draft fitness proposals", "Bulk rejection of draft/pending fitness proposals"); break;
    case "proposal_expire_duplicates": result = answerProposalRef("proposal_expire_duplicates", "Expire duplicate proposals", "Duplicate-proposal expiry"); break;
    case "proposal_history": result = answerProposalHistory(ctx); break;
    case "unknown": result = answerUnknown(ctx); break;
  }
  result.matchedKeywords = matchedKeywords;
  // Phase 14A — attach non-executable proposal drafts when a timestamp is given.
  if (ctx.now) {
    result.proposals = generateProposals({
      request: ctx.request,
      intent,
      panels: ctx.panels,
      now: ctx.now,
      ...(ctx.env ? { env: ctx.env } : {}),
      ...(ctx.orchestrator
        ? {
            orchestrator: {
              classification: ctx.orchestrator.classification,
              domain: ctx.orchestrator.domain,
              buildPlanSummary: ctx.orchestrator.buildPlanSummary,
              capabilityGaps: ctx.orchestrator.capabilityGaps,
            },
          }
        : {}),
    });
  }
  return result;
}
