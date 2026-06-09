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
import { planAgentCreation } from "./agent-planner/index.js";
import { classifyBuildRequest } from "../hartos/agent-inbox.js";
import { resolveKnownAgents } from "../agents/known-agent-registry.js";
import type { AgentContract } from "../agents/agent-contract.js";
import type { SourceDiagnosticsReport } from "./sources/index.js";
import { buildFreshnessReport, type FreshnessReport, type FreshnessVerdict } from "./freshness-surface.js";
import { planResearch } from "../research/research-planner.js";
import { proposeResearchJob } from "../research/research-job.js";
import { strategicAwareness, type StrategicBrief } from "../awareness/strategic-awareness.js";
import { executiveMemory, type MemorySnapshot, type ExecutiveMemoryReport } from "../awareness/executive-memory.js";
import { planMutationFromInstruction } from "./mutation/instruction-to-mutation.js";
import type { OpsCardRef } from "./mutation/card-target-resolver.js";

export type CockpitIntent =
  | "system_status"
  | "daily_brief"
  | "strategic_brief"
  | "executive_memory"
  | "mutate_request"
  | "fitness_status"
  | "ops_status"
  | "freshness_status"
  | "build_agent"
  | "improve_agent"
  | "strategy_review"
  | "research"
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
  /**
   * Factory v1.5 seam — contracts of agents the Factory has CREATED (officiated)
   * beyond the static AGENT_CONTRACTS. When supplied, they are composed via
   * resolveKnownAgents and fed into the Inbox's already_solved gate so a freshly
   * built agent's domain is recognised as covered. PLAIN DATA ONLY (no file/db
   * read) to stay Worker-safe. Defaults to none ⇒ behaviour is exactly the static
   * registry (no created agents exist yet — this only establishes the seam).
   */
  createdAgentContracts?: AgentContract[];
  /**
   * Executive Memory seam (Part L) — a supplied history of compact memory snapshots. PLAIN
   * DATA ONLY (no file/db read) to stay Worker-safe, mirroring createdAgentContracts. The
   * stateless Ask path supplies none, so the executive_memory intent honestly returns
   * INSUFFICIENT_HISTORY today; a future persister/host populates this and the same code
   * produces real patterns/trends/lessons. Also threaded into the strategic brief for
   * historical context when present.
   */
  memorySnapshots?: MemorySnapshot[];
  /**
   * Mutation target resolution seam — candidate ops cards (id · name · status) a mutation
   * instruction ("put this operation on hold") can resolve against. PLAIN DATA (Worker-safe),
   * populated by the live ops read-model. Absent ⇒ the mutate rehearsal honestly reports it has
   * no cards to resolve against (never guesses).
   */
  opsCards?: OpsCardRef[];
  /** The card the operator is focused on (from the cockpit drawer/click) — resolves "this/it". */
  focusedCardId?: string;
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

  // 0a.−1 MUTATION command (dry-run rehearsal) — an instruction to CHANGE something
  // ("clear my outstanding", "reject draft proposals", "archive rejected proposals",
  // "comment '…' on card <id>", "move card <id> to in review"). Placed first so mutation
  // phrasing isn't swallowed by the generic proposal-reject/list rules; patterns are tight
  // so "reject all fitness proposals" / "expire duplicates" / "show proposals" still route
  // to their hygiene intents. Produces a DRY-RUN rehearsal only — never a live write.
  {
    const cardish = has(t, "card", "task").length > 0;
    // Never steal the "reject all fitness proposals" hygiene command (handled in 0a).
    const isFitnessRejectAll = has(t, "reject all").length > 0 && has(t, "fitness").length > 0 && has(t, "proposal").length > 0;
    const isMutate = !isFitnessRejectAll && (
      has(t, "clear my outstanding", "clear the backlog", "clear outstanding", "clean up the queue", "clean the queue").length > 0 ||
      (has(t, "reject", "clear", "discard").length > 0 && has(t, "draft").length > 0 && has(t, "proposal").length > 0) ||
      (has(t, "archive", "clear", "purge").length > 0 && has(t, "rejected").length > 0 && has(t, "proposal").length > 0) ||
      (has(t, "comment", "note").length > 0 && cardish) ||
      (has(t, "move", "transition", "set status", "change status", "mark").length > 0 && cardish)
    );
    if (isMutate) return { intent: "mutate_request", matchedKeywords: ["mutate"] };
  }

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

  // 0a.3 Executive Memory — "what's recurring / what have we learned / show me the trend /
  // historical context / lessons learned". Placed before the strategic brief so memory-
  // specific asks ("recurring", "lessons", "history", "trend over time") land here.
  m = has(
    t,
    "executive memory", "recurring patterns", "what's recurring", "whats recurring", "what is recurring",
    "what keeps happening", "recurring issues", "recurring risks", "recurring problems",
    "lessons learned", "what have we learned", "what did we learn", "any lessons",
    "historical context", "what's the history", "whats the history", "over time",
    "trend over time", "long term trend", "long-term trend", "patterns over time", "what patterns"
  );
  if (m.length) return { intent: "executive_memory", matchedKeywords: m };

  // 0a.4 Strategic Awareness Brief — "what should I be aware of / what's drifting / what
  // am I not seeing". Distinct from the daily brief (today's to-do) and strategy review
  // (build leverage): this is the proactive risk/opportunity/drift/blind-spot scan. Placed
  // before daily_brief so "strategic brief" / "what's drifting" don't get caught by it.
  m = has(
    t,
    "strategic brief", "strategic awareness", "awareness brief", "situational awareness",
    "what should i be aware of", "what should i know", "anything i should know",
    "what's drifting", "whats drifting", "what is drifting", "any drift", "drift check",
    "what are my blind spots", "surface risks", "surface the risks", "what risks am i missing",
    "what am i not seeing", "what's slipping", "whats slipping", "anything slipping"
  );
  if (m.length) return { intent: "strategic_brief", matchedKeywords: m };

  // 0a.5 Daily Command Brief (Phase 16) — the morning "what matters today" roll-up.
  // Must beat freshness/ops/fitness/system so "what needs my attention today" lands here.
  m = has(
    t,
    "daily command brief", "command brief", "daily brief", "morning brief", "todays brief", "today's brief",
    "what needs my attention today", "what needs my attention", "needs my attention",
    "what should i focus on today", "what should i focus on", "what should i work on today",
    "what should i prioritise", "what should i prioritize", "attention today", "focus today",
    "what's on my plate", "whats on my plate", "what matters today", "brief me",
    "good morning", "morning check", "start of day", "morning",
    "what should i do today", "what do i do today",
    "where do i start today", "where should i start today",
    "what's my priority today", "whats my priority today",
    "what's today's priority", "todays priority",
    "what's the plan today", "whats the plan today"
  );
  if (m.length) return { intent: "daily_brief", matchedKeywords: m };

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

  // 2b. Research (Phase F1) — explicit research verbs only, so it never steals a
  // build ("create … agent") or strategy ("explore", "what should I build") request.
  m = has(t, "research", "investigate", "look into", "find out about", "dig into");
  if (m.length) return { intent: "research", matchedKeywords: m };

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

  // 7. Generic "what should I do / where do I start?" — only reached when no domain-specific
  // keyword matched above, so "fix stale ops" still lands on freshness_status.
  m = has(t, "what should i do", "what do i do", "what do i do next", "where do i start", "where should i start", "what's my priority", "whats my priority");
  if (m.length) return { intent: "daily_brief", matchedKeywords: m };

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
  const readiness = field(p, "training_readiness");
  const plan = field(p, "training_plan");
  const calories = field(p, "calories");
  const protein = field(p, "protein");
  const adjustment = field(p, "adjustment");
  const risk = field(p, "coach_risk");
  const opportunity = field(p, "coach_opportunity");
  const notes = field(p, "coach_notes");

  // Coach contract: Verdict · Reasoning · Key metrics · Risk · Opportunity · Recommended action.
  // The verdict is the derived training_readiness (full/controlled/easy/rest equivalent), the
  // reasoning is the coach's grounded basis, metrics are the live readings, and risk/opportunity
  // come straight from the coaching core — never generic filler.
  const verdict = adjustment?.status === "ok" && adjustment.value
    ? adjustment.value
    : "Not enough signal to coach today.";
  const confidenceTag = readiness?.confidence ? ` (${readiness.confidence} confidence)` : "";
  const keyMetrics = [
    `recovery ${recovery?.value ?? "unknown"}`,
    `plan ${plan?.value ?? "unknown"}`,
    `today done: ${field(p, "training_completed")?.value ?? "unknown"}`,
    `calories ${calories?.value ?? "unknown"}`,
    `protein ${protein?.value ?? "unknown"}`,
  ].join(" · ");

  const lines = [
    `Verdict: ${verdict}${confidenceTag}`,
    `Reasoning: ${readiness?.status === "ok" && readiness.value ? readiness.value : "Recovery/plan not fully surfaced — coaching is conservative until they are."}`,
    `Key metrics: ${keyMetrics}.`,
    `Risk: ${risk?.status === "ok" && risk.value ? risk.value : "None flagged from today's signals."}`,
    `Opportunity: ${opportunity?.status === "ok" && opportunity.value ? opportunity.value : "No standout upside to capture today — execute the plan."}`,
    notes?.status === "ok" && notes.value ? `Notes: ${notes.value}` : null,
    `Recommended action: ${p.nextAction || verdict}`,
  ].filter((x): x is string => !!x);
  const nextSteps = uniqueNonEmpty([p.nextAction, ...topN(p.missingSetupSteps, 3)]);
  return base("fitness_status", "Fitness — Coach", lines.join("\n"), p.highlights, topN(p.gaps, 5), nextSteps, false);
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

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
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

  // ── Honest confidence: how many of the core probe fields actually resolved ──
  // No invented score — confidence is purely a function of data completeness + freshness.
  const PROBE = ["active_cards", "urgent", "blocked", "waiting", "stale"];
  const resolved = PROBE.filter((k) => field(p, k)?.status === "ok").length;
  const confidence: "high" | "medium" | "low" =
    clickupStale || resolved <= 1 ? "low" : resolved >= 4 ? "high" : "medium";
  const confidenceReason = clickupStale
    ? "ClickUp data is stale"
    : `${resolved}/${PROBE.length} core ops fields resolved`;

  // Source values may already end with a period; avoid a doubled ".." .
  const endDot = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

  // Operator contract: Situation · Impact · Risk · Opportunity · Recommended action.
  // Impact / Risk / Opportunity come from the triage core (surfaced via the ops panel);
  // they read like a Chief-of-Staff brief, not a count dump. Counts stay as the Situation.
  const impactField = field(p, "triage_impact");
  const risksField = field(p, "triage_risks");
  const oppField = field(p, "triage_opportunity");
  const riskLine = risksField?.status === "ok" && risksField.value
    ? risksField.value
    : riskFlags?.status === "ok" ? `Risk flags: ${endDot(riskFlags.value)}` : "No distinct operational risk surfaced.";

  const lines = [
    `Situation: ${verdictLine} (${factsParts.join(", ")}.)`,
    `Impact: ${impactField?.status === "ok" && impactField.value ? impactField.value : (verdict === "green" ? "No work halted or threatened." : "Some fronts need attention to keep work moving.")}`,
    `Risk: ${riskLine}`,
    `Opportunity: ${oppField?.status === "ok" && oppField.value ? oppField.value : "No standout quick win right now — clear the leading front."}`,
    `Recommended action: ${mainAction}`,
    `Confidence: ${confidence.toUpperCase()} (${confidenceReason}). Source: ops read-model (ClickUp), ${clickupStale ? "STALE" : "current"}.`,
    `Latest update: ${endDot(updates?.status === "ok" ? updates.value : "none available")}`,
    `ClickUp sync: ${endDot(sync?.status === "ok" ? sync.value : "unknown")}${
      clickupStale ? " STALE: latest card activity is older than the freshness window; re-run the ClickUp import." : ""
    }`,
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
  const result = base("build_agent", "Build / new agent", lines.join("\n"), highlights, gaps, nextSteps, true);

  // Phase 17A — for an explicit "create a <X> agent" request, surface the dry-run
  // Agent Creation Plan summary and ask for the first missing requirement. The
  // ranked "what should I build" path is unaffected.
  const wantsRanked = /what should i build|what to build|build next|what next/i.test(ctx.request);
  if (!wantsRanked) {
    // Factory v1 Inbox triage (step 1): refuse unsafe, flag already-solved; only
    // buildable/too_vague continue into the dry-run Agent Creation Plan.
    //
    // Factory v1.5 seam: compose the static AGENT_CONTRACTS with any CREATED-agent
    // contracts the caller injected (resolveKnownAgents validates + dedupes, static
    // wins, never mutates AGENT_CONTRACTS). With none supplied this resolves to the
    // static registry, so the already_solved gate is unchanged until agents are born.
    const inbox = classifyBuildRequest(ctx.request, {
      contracts: resolveKnownAgents(ctx.createdAgentContracts),
    });
    const plan = planAgentCreation(ctx.request);
    const inboxLine =
      inbox.label === "unsafe"
        ? `Inbox: REFUSED (unsafe) — ${inbox.unsafeExclusion ?? inbox.reasons[0] ?? "matches a doctrine exclusion"}. HartOS will not build this.`
        : inbox.label === "already_solved"
          ? `Inbox: already solved — ${inbox.matchedAgent ?? "an existing agent"} already covers this; improve it instead of building new.`
          : inbox.label === "too_vague"
            ? "Inbox: too vague to build — interrogate the spec first."
            : "Inbox: buildable — proceeds to spec interrogation before any build.";
    // CTO challenge — the Factory does NOT auto-agree. For buildable/too-vague requests it
    // surfaces feasibility, the concrete failure modes, and (when the plan is weak) pushes
    // back with a sharper alternative instead of nodding the build through.
    const ctoChallenge = inbox.label === "buildable" || inbox.label === "too_vague"
      ? buildCtoChallenge(plan)
      : "";
    result.summary = `${inboxLine}\n${plan.summary}${ctoChallenge}\n\n${result.summary}`;
    if (inbox.label === "unsafe") {
      // An unsafe request is refused, not interrogated.
      result.clarifyingQuestion = null;
    } else if (plan.draft.clarifyingQuestions.length > 0) {
      result.clarifyingQuestion = plan.draft.clarifyingQuestions[0]!;
    }
  }
  return result;
}

/**
 * The Factory's CTO voice: a principal-engineer challenge of the proposed build. It does NOT
 * rubber-stamp — it states feasibility, names the concrete failure modes, and pushes back when
 * the plan is weak (DO_NOT_BUILD / MERGE / a simpler alternative exists / high strategy risk).
 * Pure: reads only the deterministic plan the agent-planner already produced.
 */
function buildCtoChallenge(plan: ReturnType<typeof planAgentCreation>): string {
  const lines: string[] = ["", "CTO challenge:"];
  const verdict = plan.strategy.verdict;

  // Feasibility — is this even the right thing to build?
  const weak = verdict === "DO_NOT_BUILD" || verdict === "MERGE_WITH_EXISTING_AGENT" || !!plan.strategy.simplerAlternative;
  if (verdict === "DO_NOT_BUILD") {
    lines.push(`- Feasibility: PUSH BACK — strategy says DO NOT BUILD. ${plan.strategy.reason}`);
  } else if (verdict === "MERGE_WITH_EXISTING_AGENT") {
    lines.push(`- Feasibility: PUSH BACK — this should extend an existing agent, not spawn a new one. ${plan.strategy.reason}`);
  } else if (!plan.readyToPlanScaffold) {
    lines.push(`- Feasibility: NOT YET — requirements are incomplete; the plan is provisional until the open questions are answered.`);
  } else {
    lines.push(`- Feasibility: workable (${verdict}); ${plan.strategy.reason}`);
  }

  // Failure modes — name them concretely (don't hand-wave "there are risks").
  if (plan.risks.length) {
    lines.push("- Failure modes:");
    for (const r of plan.risks.slice(0, 4)) lines.push(`  · ${r}`);
  } else {
    lines.push("- Failure modes: none flagged by the planner — but verify scope before committing engineering time.");
  }

  // Better alternative — the CTO's job is to propose the cheaper path when one exists.
  const alt = plan.doNotBuild.find((d) => /simpler alternative/i.test(d)) ?? (plan.strategy.simplerAlternative ? `Simpler alternative: ${plan.strategy.simplerAlternative}` : null);
  if (alt) lines.push(`- Cheaper path: ${alt}`);

  // The challenge verdict.
  lines.push(
    weak
      ? "- Verdict: DON'T build this as specified — resolve the pushback above first."
      : plan.readyToPlanScaffold
        ? "- Verdict: proceed to spec interrogation; the build is justified and scoped."
        : "- Verdict: answer the open questions, then re-run — don't scaffold on an incomplete spec.",
  );
  return `\n${lines.join("\n")}`;
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

// ─── Daily Command Brief (Phase 16) ──────────────────────────────────────────

export interface OpsSignals {
  active: number | null;
  urgent: number;
  blocked: number;
  waiting: number;
  stale: number;
  noNextAction: number;
  clickupStale: boolean;
}

/**
 * Pure extraction of the ops attention signals from the ops panel. Only counts
 * fields that resolved to a real value; never fabricates numbers. Shared by the
 * daily brief so the ops verdict it shows matches the dedicated ops answer.
 */
export function extractOpsSignals(panel: DomainPanel | undefined): OpsSignals {
  const numFromField = (key: string): number | null => {
    const f = field(panel, key);
    if (!f || f.status !== "ok") return null;
    const n = Number(f.value);
    return Number.isFinite(n) ? n : null;
  };
  const n0 = (key: string): number => numFromField(key) ?? 0;
  const STALE_PROBE_FIELDS = ["active_cards", "urgent", "blocked", "waiting", "stale", "clickup_sync", "latest_updates"];
  return {
    active: numFromField("active_cards"),
    urgent: n0("urgent"),
    blocked: n0("blocked"),
    waiting: n0("waiting"),
    stale: n0("stale"),
    noNextAction: n0("no_next_action"),
    clickupStale: STALE_PROBE_FIELDS.some((k) => field(panel, k)?.freshness === "stale"),
  };
}

/** Worst of two traffic-light verdicts (red > amber > green). */
function worstVerdict(a: FreshnessVerdict, b: OpsVerdict): FreshnessVerdict {
  const rank = { green: 0, amber: 1, red: 2 } as const;
  return rank[a] >= rank[b] ? a : (b as FreshnessVerdict);
}

/**
 * Phase 16 — the hosted Daily Command Brief. A grounded morning roll-up:
 * overall verdict, the single main action, the top 3 attention items, and a
 * compact Fitness / Ops / Factory-Proposal / Freshness line. Invents nothing;
 * honest about stale ops and (in hosted mode) unavailable Factory reports.
 * Creates ZERO proposals (status intent).
 */
function answerDailyBrief(ctx: IntentRouterContext): CockpitIntentResult {
  const fitnessP = panelById(ctx.panels, "fitness");
  const opsP = panelById(ctx.panels, "ops");
  const factoryP = panelById(ctx.panels, "factory");
  const fr = freshnessFromCtx(ctx);
  const ops = extractOpsSignals(opsP);
  const opsVerdict = opsP ? computeOpsVerdict(ops) : "amber";
  const overall = worstVerdict(fr.verdict, opsVerdict);
  const verdictWord = overall.charAt(0).toUpperCase() + overall.slice(1);

  // ── attention items (most important first), grounded only ──
  const attention: string[] = [];
  if (ops.blocked > 0) attention.push(`Ops: ${ops.blocked} blocked/at-risk ${plural(ops.blocked, "card")}.`);
  if (ops.urgent > 0) attention.push(`Ops: ${ops.urgent} urgent ${plural(ops.urgent, "card")}.`);
  if (ops.waiting > 0) attention.push(`Ops: ${ops.waiting} ${plural(ops.waiting, "card")} waiting on Hart.`);
  if (ops.clickupStale || fr.clickup.stale) {
    attention.push(`Ops/ClickUp data is stale${fr.clickup.lastImportAt ? ` (last activity ${fr.clickup.lastImportAt})` : ""} — refresh before deciding.`);
  }
  if (ops.stale > 0) attention.push(`Ops: ${ops.stale} stale ${plural(ops.stale, "card")}.`);
  if (ops.noNextAction > 0) attention.push(`Ops: ${ops.noNextAction} ${plural(ops.noNextAction, "card")} without a next action.`);
  for (const d of fr.domains) {
    if (d.domain !== "ops" && d.state !== "fresh") attention.push(`${capitalize(d.domain)}: ${d.state} — ${d.reason}`);
  }
  if (fitnessP && field(fitnessP, "recovery")?.status === "ok") {
    const rec = field(fitnessP, "recovery")!.value;
    if (/low|red|poor|under/i.test(rec)) attention.push(`Fitness: recovery is ${rec} — adjust training load.`);
  }
  const top3 = topN(attention, 3);

  // ── the single main action ──
  let mainAction: string;
  if (ops.blocked > 0) mainAction = `Triage the ${ops.blocked} blocked/at-risk ops ${plural(ops.blocked, "card")} first.`;
  else if (ops.urgent > 0) mainAction = `Action the ${ops.urgent} urgent ops ${plural(ops.urgent, "card")}.`;
  else if (ops.clickupStale || fr.clickup.stale) mainAction = `Refresh Ops/ClickUp (re-run the import manually), then re-check ops${ops.waiting > 0 ? ` and clear the ${ops.waiting} ${plural(ops.waiting, "card")} waiting on Hart` : ""}.`;
  else if (ops.waiting > 0) mainAction = `Clear the ${ops.waiting} ops ${plural(ops.waiting, "card")} waiting on Hart.`;
  else if (overall !== "green") mainAction = fr.safeNextStep;
  else mainAction = "Nothing urgent — keep monitoring; pick the highest-leverage build when you have time.";

  // ── compact per-area lines ──
  const factoryReportsAvailable = factoryP
    ? factoryP.fields.some((f) => /report|verification/i.test(f.key) && f.status === "ok")
    : false;
  const queue = ctx.proposalQueue ?? [];
  const pendingProposals = queue.filter((p) => p.status === "draft" || p.status === "pending_approval").length;
  const factoryProposalLine = `Factory: ${
    factoryReportsAvailable ? "local reports available" : "local reports unavailable in hosted mode"
  }; proposals: ${queue.length} total${pendingProposals ? `, ${pendingProposals} pending` : ""} (all non-executable / dry-run only).`;

  const fitnessLine = fitnessP
    ? `Fitness: recovery ${field(fitnessP, "recovery")?.value ?? "unknown"}; today ${field(fitnessP, "training_plan")?.value ?? "unknown"}; calories ${field(fitnessP, "calories")?.value ?? "unknown"}, protein ${field(fitnessP, "protein")?.value ?? "unknown"}.`
    : "Fitness: panel unavailable (configure the fitness agent).";
  const opsLine = opsP
    ? `Ops: ${opsVerdict.toUpperCase()} — ${ops.active != null ? `${ops.active} active, ` : ""}${ops.urgent} urgent, ${ops.blocked} blocked/risk, ${ops.waiting} waiting on Hart${ops.clickupStale ? "; ClickUp data is stale" : ""}.`
    : "Ops: panel unavailable (configure the ops agent).";
  const freshnessLine = `Freshness: ${fr.verdict.toUpperCase()} — ${fr.domains.map((d) => `${capitalize(d.domain)} ${d.state}`).join(", ")}.`;

  // ── known gaps (honest; do not invent) ──
  const gaps = uniqueNonEmpty([
    ...fr.domains.filter((d) => d.state !== "fresh").map((d) => `${capitalize(d.domain)}: ${d.state} — ${d.reason}`),
    !factoryReportsAvailable ? "Factory: local reports are unavailable in hosted mode (snapshot only)." : undefined,
    ...(opsP?.gaps ?? []).filter((g) => /missing source|not wired/i.test(g)).slice(0, 1),
  ]);

  const lines: string[] = [
    `Command Brief: ${verdictWord}.`,
    `Main action: ${mainAction}`,
    "",
    "Top attention items:",
    ...(top3.length ? top3.map((a, i) => `${i + 1}. ${a}`) : ["1. Nothing needs your attention right now."]),
    "",
    fitnessLine,
    opsLine,
    factoryProposalLine,
    freshnessLine,
  ];
  if (fr.clickup.stale) lines.push("Caution: ops data is stale — don't make important ops decisions until you refresh ClickUp.");
  lines.push("Note: the hosted cockpit is read-only — it cannot run imports, deploys, or any action for you.");
  if (gaps.length) lines.push(`Known gaps: ${gaps.join(" ")}`);

  const highlights = uniqueNonEmpty([
    `Overall: ${overall.toUpperCase()}.`,
    `Main action: ${mainAction}`,
    ...top3,
  ]);
  const nextSteps = uniqueNonEmpty([
    mainAction,
    overall !== "green" ? fr.safeNextStep : undefined,
    "Ask: \"Is my data fresh?\" or \"Anything urgent in ops?\" for detail.",
  ]);
  return base("daily_brief", "Daily Command Brief", lines.join("\n"), highlights, topN(gaps, 5), nextSteps, false);
}

/**
 * Strategic Awareness Brief — the proactive "what should I be aware of" scan. Runs the
 * pure strategicAwareness aggregator over the panels + freshness + proposal queue the
 * router already has (cross-system perception/forecast are optional enrichment supplied
 * only by the dashboard view, not the Ask path). Honest: when evidence is insufficient it
 * says so and surfaces nothing. Creates ZERO proposals (awareness intent).
 */
function answerStrategicBrief(ctx: IntentRouterContext): CockpitIntentResult {
  const fr = freshnessFromCtx(ctx);
  const brief = strategicAwareness({
    now: ctx.now ?? fr.domains[0]?.lastUpdated ?? "",
    panels: ctx.panels,
    freshness: fr,
    proposals: ctx.proposalQueue ?? [],
    // Executive Memory enrichment — present only when a host has supplied history.
    ...(ctx.memorySnapshots ? { history: ctx.memorySnapshots } : {}),
  });

  if (brief.status === "insufficient_evidence") {
    return base(
      "strategic_brief",
      "Strategic brief — Chief of Staff",
      `Status: UNKNOWN.\n${brief.note}`,
      [],
      ["No domain has resolved live data — awareness can't be earned yet."],
      [fr.safeNextStep || "Configure/refresh the agent sources, then re-ask."],
      false,
    );
  }

  const lines = strategicBriefLines(brief);
  const highlights = uniqueNonEmpty([
    brief.recommendedFocus ? `Focus: ${brief.recommendedFocus}` : undefined,
    ...brief.risks.slice(0, 2).map((r) => `Risk: ${r.risk}`),
  ]);
  const gaps = brief.blindSpots.map((b) => b.blindSpot);
  const nextSteps = uniqueNonEmpty([
    brief.recommendedFocus ? brief.recommendedFocus.split(" — ").slice(-1)[0] : undefined,
    ...brief.opportunities.slice(0, 1).map((o) => o.suggestedAction),
    ...brief.drift.slice(0, 1).map((d) => d.suggestedCorrection),
  ]);
  return base("strategic_brief", "Strategic brief — Chief of Staff", lines.join("\n"), highlights, topN(gaps, 4), nextSteps, false);
}

/** Render a Strategic Brief into the concise, signal-over-noise text contract. */
function strategicBriefLines(b: StrategicBrief): string[] {
  const lines: string[] = [];
  if (b.recommendedFocus) lines.push(`Recommended focus: ${b.recommendedFocus}`);
  if (b.risks.length) {
    lines.push("", "Top risks:");
    for (const r of b.risks) {
      const hist = r.historicalContext ? ` [History: ${r.historicalContext}]` : "";
      lines.push(`- ${r.risk} (${r.confidence}) — ${r.why} Evidence: ${r.evidence}${hist} → ${r.suggestedAction}`);
    }
  }
  if (b.opportunities.length) {
    lines.push("", "Top opportunities:");
    for (const o of b.opportunities) lines.push(`- ${o.opportunity} (${o.confidence}) — ${o.why} Upside: ${o.upside} → ${o.suggestedAction}`);
  }
  if (b.drift.length) {
    lines.push("", "Drift signals:");
    for (const d of b.drift) lines.push(`- ${d.drift} — ${d.evidence} Impact: ${d.impact} → ${d.suggestedCorrection}`);
  }
  if (b.blindSpots.length) {
    lines.push("", "Blind spots (questions to ask):");
    for (const s of b.blindSpots) lines.push(`- ${s.blindSpot}`);
  }
  // Executive Memory sections (present only when history was supplied).
  if (b.recurringPatterns && b.recurringPatterns.length) {
    lines.push("", "Recurring patterns:");
    for (const p of b.recurringPatterns) lines.push(`- ${p.subject} (${p.kind}) — ${p.evidence}`);
  }
  if (b.lessons && b.lessons.length) {
    lines.push("", "Lessons learned:");
    for (const l of b.lessons) lines.push(`- ${l.lesson} (${l.confidence}) — ${l.basis}`);
  }
  if (b.trendSummary && b.trendSummary.length) {
    lines.push("", `Trend summary: ${b.trendSummary.join("; ")}.`);
  }
  lines.push("", b.note);
  return lines;
}

/**
 * Executive Memory answer — the historical/pattern/trend/lesson view. Uses the supplied
 * memory-snapshot seam (ctx.memorySnapshots). HONEST: the stateless Ask path supplies no
 * history, so this returns INSUFFICIENT_HISTORY today — never invents patterns or lessons.
 * A future persister populates ctx.memorySnapshots and the same code surfaces real memory.
 * Creates ZERO proposals.
 */
function answerExecutiveMemory(ctx: IntentRouterContext): CockpitIntentResult {
  const snapshots = ctx.memorySnapshots ?? [];
  const memory = executiveMemory(snapshots, { now: ctx.now ?? "" });

  if (memory.status === "insufficient_history") {
    return base(
      "executive_memory",
      "Executive memory",
      `Status: INSUFFICIENT_HISTORY.\n${memory.note}\n\nExecutive memory is earned from a history of snapshots; none are wired into this (stateless) path yet, so HartOS will not invent patterns, trends, or lessons. When a persister supplies history, this surfaces recurring patterns, trends, and evidence-based lessons.`,
      [],
      ["No memory history supplied — patterns/trends/lessons require a persisted snapshot stream."],
      ["Wire a memory-snapshot persister (Part L seam: ctx.memorySnapshots), then re-ask."],
      false,
    );
  }

  const lines = executiveMemoryLines(memory);
  const highlights = uniqueNonEmpty([
    memory.recurringPatterns[0] ? `Top pattern: ${memory.recurringPatterns[0].subject} (${memory.recurringPatterns[0].occurrences}×)` : undefined,
    memory.lessons[0] ? `Lesson: ${memory.lessons[0].lesson}` : undefined,
  ]);
  const nextSteps = uniqueNonEmpty(memory.recurringPatterns.slice(0, 2).map((p) => `Address the recurring ${p.kind}: ${p.subject}.`));
  return base("executive_memory", "Executive memory", lines.join("\n"), highlights, [], nextSteps, false);
}

/** Render an Executive Memory report into the concise text contract. */
function executiveMemoryLines(m: ExecutiveMemoryReport): string[] {
  const lines: string[] = [];
  if (m.recurringPatterns.length) {
    lines.push("Recurring patterns:");
    for (const p of m.recurringPatterns) lines.push(`- ${p.subject} (${p.kind}) — ${p.evidence} [score ${p.qualityScore}]`);
  }
  if (m.trends.length) {
    lines.push("", "Trends:");
    for (const t of m.trends) lines.push(`- ${t.evidence} → ${t.direction.toUpperCase()}`);
  }
  if (m.lessons.length) {
    lines.push("", "Lessons learned:");
    for (const l of m.lessons) lines.push(`- ${l.lesson} (${l.confidence}) — ${l.basis}`);
  }
  if (m.decisions.length) {
    lines.push("", "Tracked decisions:");
    for (const d of m.decisions) lines.push(`- ${d.at} [${d.domain}] ${d.decision}${d.outcome ? ` → outcome: ${d.outcome}` : " (outcome pending)"}`);
  }
  lines.push("", m.note);
  return lines;
}

/**
 * Mutation answer — a DRY-RUN rehearsal of a "do this for me" instruction. Parses the command,
 * builds the typed, gated mutation proposal it WOULD create, and shows it. NEVER writes: the
 * proposal is executable:false and the real executor stays flag-gated default-OFF. Honest:
 * internal cohort cleanups (reject-drafts / archive-rejected) are fully rehearsed; ClickUp
 * card actions return needs_target because the read-only snapshot carries no individual cards.
 * Creates ZERO live effects and ZERO queued proposals (rehearsal only).
 */
function answerMutate(ctx: IntentRouterContext): CockpitIntentResult {
  const r = planMutationFromInstruction(ctx.request, {
    now: ctx.now ?? "",
    ...(ctx.opsCards ? { candidates: ctx.opsCards } : {}),
    ...(ctx.focusedCardId ? { focusedCardId: ctx.focusedCardId } : {}),
  });
  const banner = "REHEARSAL — nothing is written. This shows the gated proposal HartOS would create; approving + arming an ALLOW_EXEC_* flag is a separate, explicit step.";

  if (r.status === "ambiguous") {
    const list = (r.candidates ?? []).map((c) => `- ${c.cardName} (${c.cardId}) · ${c.status}`).join("\n");
    return base(
      "mutate_request",
      "Mutation — rehearsal (ambiguous)",
      `Status: AMBIGUOUS — ${r.note}\nCandidates:\n${list}\n\n${banner}`,
      [],
      ["More than one card matched — HartOS won't guess."],
      ["Re-ask naming the card or pasting its id."],
      false,
    );
  }

  if (r.status === "blocked") {
    return base(
      "mutate_request",
      "Mutation — rehearsal (transition not approved)",
      `Status: BLOCKED — ${r.note}\n\n${banner}`,
      [],
      [`The transition is not in the approved allowlist — the executor would refuse it.`],
      [`Add the transition to APPROVED_CLICKUP_TRANSITIONS (your say-so), then re-ask.`],
      false,
    );
  }

  if (r.status === "unrecognized") {
    return base(
      "mutate_request",
      "Mutation — rehearsal",
      `Status: UNRECOGNIZED.\n${r.note}\n\n${banner}`,
      [],
      ["No recognized mutation in the instruction."],
      ["Try: \"reject the draft proposals\" · \"archive the rejected proposals\" · \"comment 'paid' on card <id>\""],
      false,
    );
  }

  if (r.status === "needs_target") {
    return base(
      "mutate_request",
      "Mutation — rehearsal (needs target)",
      `Status: NEEDS_TARGET — parsed a ${r.parsed.action} (T3 external).\nReason: ${r.parsed.reason}\n${r.note}\nStill required: ${r.required.join(", ")}.\n\n${banner}`,
      [`Parsed: ${r.parsed.action}`],
      [`Target unresolved — the read-only snapshot has no individual ClickUp cards; HartOS will not guess one.`],
      [`Supply the resolved target (${r.required.join(", ")}), then re-ask to complete the T3 rehearsal.`],
      false,
    );
  }

  // status === "ready" — a complete, tier-valid T0 rehearsal proposal.
  const p = r.proposal!;
  const lines = [
    `Status: READY — ${r.note}`,
    "",
    `Proposal: ${p.title}`,
    `Tier: ${p.tier} · domain: ${p.domain} · risk: ${p.riskLevel} · approval: ${p.requiredApproval}`,
    `Target: ${p.targetName} (${p.targetId})`,
    `Effect (dry-run): ${p.dryRunResult?.wouldHappen ?? p.expectedEffect}`,
    `Rollback: ${p.rollbackOrCorrectionNote}`,
    `Idempotency: ${p.idempotencyKey}`,
    `Tier-payload check: ${r.tierCheck?.allowed ? "complete ✓" : `incomplete (${r.tierCheck?.denials.join(", ")})`}`,
    "",
    banner,
  ];
  const result = base(
    "mutate_request",
    "Mutation — rehearsal (ready)",
    lines.join("\n"),
    [`Would create a ${p.tier} ${p.domain} proposal: ${p.title}`],
    [],
    ["Approve this proposal in the cockpit, then arm the action's ALLOW_EXEC_* flag on the Node host to execute for real."],
    false,
  );
  // Phase 1 — surface the READY mutation proposal so it can be PERSISTED + APPROVED (the
  // approve→executor loop). It stays a draft, executable:false; approval (gated transition) is
  // what later makes it approved_for_execution, and only then does the host executor act.
  result.proposals = [p];
  return result;
}

/** Phase F1 — a deterministic research plan (decompose + name what to gather; never answer). */
function answerResearch(ctx: IntentRouterContext): CockpitIntentResult {
  const plan = planResearch(ctx.request);
  const summary = [
    `Research plan (${plan.shape}): ${plan.verdict} — ${plan.reason}`,
    "",
    "Sub-questions:",
    ...plan.subQuestions.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Needs gathering: ${plan.requiredInputs.join("; ")}.`,
    `Risk: ${plan.risk}.`,
    "Note: this PLANS the research and names what to gather — it does not fabricate answers; the sub-questions stay unanswered until sources are gathered.",
  ].join("\n");
  const highlights = [`${plan.verdict} — ${plan.shape}-shaped, risk ${plan.risk}.`, ...plan.subQuestions.slice(0, 3)];
  const result = base("research", "Research plan", summary, highlights, plan.unknowns.slice(0, 5), [plan.recommendedNextAction], false);

  // Research intent wiring — propose a non-executable Research Job so Hart can
  // inspect the interrogation questions + scope before approving. Falls through
  // to the base result if proposeResearchJob throws (e.g. upstream plan error).
  const wantsResearch =
    /research|investigate|analyze|analyse|study|report on|find out/i.test(ctx.request);
  if (wantsResearch) {
    try {
      const { proposal } = proposeResearchJob(ctx.request, { now: ctx.now });
      result.proposals = [proposal];
    } catch {
      // fall through — base result is returned without a proposal
    }
  }

  return result;
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
  // Failure-recovery format: what failed · likely cause · exact next step · route to check · expected healthy result.
  const summary = [
    `${capitalize(name)} status is UNAVAILABLE — no ${name} panel resolved.`,
    `Likely cause: the ${name} agent isn't in agent-integrations.local.json, or its read-model env isn't set on the Worker.`,
    `Next step: add the ${name} agent to agent-integrations.local.json, then run \`npm run agents:status\` to confirm it's detected.`,
    `Check: \`npm run read-models:status\` (source wiring) and GET /api/read-models/status (live snapshot).`,
    `Expected when healthy: ${name} appears as a configured source with a live/fresh read-model and this answer shows a verdict.`,
  ].join("\n");
  return base(
    intent,
    title,
    summary,
    [`${capitalize(name)}: UNAVAILABLE (not configured).`],
    [`${name} panel unavailable — source not wired.`],
    [
      `Add the ${name} agent to agent-integrations.local.json, then run npm run agents:status.`,
      `npm run read-models:status`,
    ],
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
    case "daily_brief": result = answerDailyBrief(ctx); break;
    case "strategic_brief": result = answerStrategicBrief(ctx); break;
    case "executive_memory": result = answerExecutiveMemory(ctx); break;
    case "mutate_request": result = answerMutate(ctx); break;
    case "fitness_status": result = answerFitness(ctx); break;
    case "ops_status": result = answerOps(ctx); break;
    case "freshness_status": result = answerFreshness(ctx); break;
    case "build_agent": result = answerBuild(ctx); break;
    case "improve_agent": result = answerImprove(ctx); break;
    case "strategy_review": result = answerStrategy(ctx); break;
    case "research": result = answerResearch(ctx); break;
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
  // mutate_request sets its OWN typed mutation proposal (the rehearsal) — don't clobber it.
  if (ctx.now && intent !== "mutate_request") {
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
