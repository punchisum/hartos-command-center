/**
 * src/cockpit/agent-planner/agent-planner.ts
 *
 * Phase 17A — Agent Creation Planner (DRY-RUN ONLY).
 *
 * Turns a cockpit "create a <X> agent" request into a structured, non-executable
 * PLAN: a lightweight requirements draft (with clarifying questions for missing
 * fields), the deterministic classification + strategy verdict, recommended
 * skills, required capabilities, a plan-level repo-scaffold outline, and a
 * dry-run provider/provisioning outline with the gates that would block real
 * execution.
 *
 * Doctrine (matches the cockpit proposal system):
 *   - PURE. No filesystem, no network, no provider calls, no mutation. Safe to
 *     run inside the hosted Cloudflare Worker (no node:fs in this module's graph).
 *   - PLAN-LEVEL, not execution. The exact Factory AgentConfig + byte-precise
 *     scaffold manifest are intentionally NOT produced here — they belong to a
 *     future EXECUTION phase that runs with the Agent Factory. This module
 *     deliberately does not fork the Factory's AgentConfig/scaffold manifest.
 *   - PROPOSE, DON'T ACT. The output is surfaced as a non-executable proposal
 *     requiring Hart's approval. Nothing is created.
 */

import { classifyRequest, requiredCapabilitiesFor } from "../../hartos/request-classifier.js";
import { reviewStrategy } from "../../hartos/strategy-review.js";
import type { ClassifiedRequest, StrategyReviewResult, RiskLevel } from "../../hartos/orchestrator-types.js";

/** A required field the planner still needs from Hart before a spec is complete. */
export type AgentDraftField = "commands" | "dataSources" | "interfaces";

/** Optional answers Hart can supply across turns to complete the draft. */
export interface AgentDraftAnswers {
  name?: string;
  interfaces?: string[];
  commands?: string[];
  dataSources?: string[];
}

/** A lightweight, cockpit-side requirements draft — NOT the Factory AgentConfig. */
export interface AgentCreationDraft {
  request: string;
  name: string;
  purpose: string;
  domain: ClassifiedRequest["domain"];
  buildTarget: ClassifiedRequest["buildTarget"];
  interfaces: string[];
  commands: string[];
  dataSources: string[];
  riskLevel: RiskLevel;
  missingFields: AgentDraftField[];
  clarifyingQuestions: string[];
}

export interface ScaffoldPlanItem {
  path: string;
  kind: "dir" | "file";
  note: string;
}

export interface ProviderPlanItem {
  provider: string;
  reason: string;
  /** The deploy gate that would block real provisioning (stays closed in 17A). */
  gate: string;
  mutation: boolean;
}

export interface AgentCreationPlan {
  draft: AgentCreationDraft;
  classification: ClassifiedRequest;
  strategy: StrategyReviewResult;
  recommendedSkills: string[];
  requiredCapabilities: string[];
  /** Plan-level — what a Factory scaffold WOULD create. Nothing is written. */
  scaffoldPlan: ScaffoldPlanItem[];
  /** Dry-run — providers the agent would need + the gate that blocks each. */
  providerPlan: ProviderPlanItem[];
  approvalGates: string[];
  risks: string[];
  doNotBuild: string[];
  /** False while the draft still has missing required fields. */
  readyToPlanScaffold: boolean;
  summary: string;
}

/** Authoritative skill catalog lives in the Agent Factory (/skills). Mirrored
 *  here only as a recommendation surface — the planner never reads the Factory. */
export const FACTORY_SKILL_CATALOG = [
  "agent-factory",
  "credential-manager",
  "handover-writer",
  "incident-repair",
  "security-review",
  "supabase-rpc-builder",
  "system-architect",
  "telegram-command-builder",
  "trigger-job-builder",
  "verification-loop",
] as const;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** Derive a kebab-case agent name from the request (e.g. "tax" -> "tax-agent"). */
export function deriveAgentName(request: string, fallbackDomain: string): string {
  const m = /(?:create|build|make|new|scaffold|spin up)\s+(?:(?:a|an|the)\s+)?([a-z][a-z0-9 -]*?)\s+agent\b/i.exec(request);
  if (m && m[1]) {
    const base = slug(m[1]);
    if (base) return base.endsWith("-agent") ? base : `${base}-agent`;
  }
  const dom = slug(fallbackDomain);
  return dom && dom !== "unknown" ? `${dom}-agent` : "new-agent";
}

const FIELD_QUESTIONS: Record<AgentDraftField, string> = {
  commands: "What are the main commands or tasks this agent should handle?",
  dataSources: "What data should it read (e.g. Supabase tables, ClickUp, uploaded files)?",
  interfaces: "How will you interact with it (telegram, web cockpit, dashboard)?",
};

/** Build the requirements draft from the request + any answers gathered so far. Pure. */
export function buildAgentDraft(request: string, answers: AgentDraftAnswers = {}): AgentCreationDraft {
  const c = classifyRequest(request);
  const name = answers.name?.trim() ? slug(answers.name) : deriveAgentName(request, c.domain);
  const interfaces = (answers.interfaces ?? []).filter((s) => s.trim().length > 0);
  const commands = (answers.commands ?? []).filter((s) => s.trim().length > 0);
  const dataSources = (answers.dataSources ?? []).filter((s) => s.trim().length > 0);

  const missingFields: AgentDraftField[] = [];
  if (commands.length === 0) missingFields.push("commands");
  if (dataSources.length === 0) missingFields.push("dataSources");
  if (interfaces.length === 0) missingFields.push("interfaces");

  return {
    request,
    name,
    purpose: request.trim(),
    domain: c.domain,
    buildTarget: c.buildTarget,
    interfaces,
    commands,
    dataSources,
    riskLevel: c.riskLevel,
    missingFields,
    clarifyingQuestions: missingFields.map((f) => FIELD_QUESTIONS[f]),
  };
}

/** Recommend skills from the Factory catalog. Deterministic, advisory only. */
export function recommendSkills(draft: AgentCreationDraft): string[] {
  const picks = new Set<string>([
    "agent-factory",
    "system-architect",
    "verification-loop",
    "security-review",
    "handover-writer",
    "credential-manager",
  ]);
  const text = `${draft.request} ${draft.interfaces.join(" ")} ${draft.dataSources.join(" ")}`.toLowerCase();
  if (/telegram|chat|bot/.test(text) || draft.interfaces.length === 0) picks.add("telegram-command-builder");
  if (/supabase|database|table|rpc/.test(text) || draft.domain === "ops" || draft.domain === "fitness") picks.add("supabase-rpc-builder");
  if (/schedule|cron|daily|nightly|recurring|digest/.test(text)) picks.add("trigger-job-builder");
  // Keep only catalog-valid skills, stable order.
  return FACTORY_SKILL_CATALOG.filter((s) => picks.has(s));
}

/** Plan-level repo scaffold outline — what a Factory scaffold WOULD create. */
export function planScaffold(draft: AgentCreationDraft, skills: string[]): ScaffoldPlanItem[] {
  const notCreated = "(planned only — not created; execution deferred to the Agent Factory)";
  const items: ScaffoldPlanItem[] = [
    { path: `${draft.name}/`, kind: "dir", note: notCreated },
    { path: `${draft.name}/agent.yaml`, kind: "file", note: "agent spec (Factory AgentConfig) " + notCreated },
    { path: `${draft.name}/AGENTS.md`, kind: "file", note: notCreated },
    { path: `${draft.name}/src/`, kind: "dir", note: "runtime (cockpit, read-models, hosted Worker) " + notCreated },
    { path: `${draft.name}/scripts/`, kind: "dir", note: notCreated },
    { path: `${draft.name}/tests/`, kind: "dir", note: notCreated },
    { path: `${draft.name}/docs/`, kind: "dir", note: notCreated },
    { path: `${draft.name}/supabase/migrations/`, kind: "dir", note: notCreated },
    { path: `${draft.name}/wrangler.cockpit.toml.example`, kind: "file", note: "hosted cockpit (Phase 16) " + notCreated },
    { path: `${draft.name}/.dev.vars.example`, kind: "file", note: notCreated },
    { path: `${draft.name}/read-models.example.json`, kind: "file", note: notCreated },
  ];
  for (const skill of skills) {
    items.push({ path: `${draft.name}/.agents/skills/${skill}/`, kind: "dir", note: notCreated });
  }
  return items;
}

/** Dry-run provider/provisioning outline + the gate that would block each step. */
export function planProviders(draft: AgentCreationDraft): ProviderPlanItem[] {
  const text = `${draft.request} ${draft.interfaces.join(" ")} ${draft.dataSources.join(" ")}`.toLowerCase();
  const items: ProviderPlanItem[] = [
    { provider: "github", reason: "Create the agent repository.", gate: "ALLOW_GITHUB_PROVISION", mutation: true },
    { provider: "supabase", reason: "Provision the agent database + read-only RPC surfaces.", gate: "ALLOW_SUPABASE_PROVISION", mutation: true },
    { provider: "cloudflare", reason: "Deploy the hosted read-only cockpit Worker.", gate: "ALLOW_CLOUDFLARE_COCKPIT_DEPLOY", mutation: true },
    { provider: "openai", reason: "Verify the LLM gateway key (read-only check).", gate: "ALLOW_OPENAI_VERIFY", mutation: false },
  ];
  if (/telegram|chat|bot/.test(text) || draft.interfaces.some((i) => /telegram/i.test(i))) {
    items.push({ provider: "telegram", reason: "Register the Telegram bot + webhook.", gate: "ALLOW_TELEGRAM_PROVISION", mutation: true });
  }
  if (/schedule|cron|daily|nightly|recurring|digest/.test(text)) {
    items.push({ provider: "trigger", reason: "Deploy scheduled jobs.", gate: "ALLOW_TRIGGER_PROVISION", mutation: true });
  }
  return items;
}

function domainRisks(draft: AgentCreationDraft, strategy: StrategyReviewResult): string[] {
  const risks: string[] = [];
  if (draft.domain === "finance" || draft.domain === "tax") {
    risks.push("Financial/tax domain — high accuracy + audit-trail requirements; human approval is mandatory before any action.");
  }
  if (strategy.risk === "high") risks.push(`Strategy risk is high: ${strategy.reason}`);
  if (strategy.maintenanceBurden === "high") risks.push("High maintenance burden — prefer extending an existing agent if possible.");
  if (draft.missingFields.length > 0) risks.push("Requirements incomplete — plan is provisional until clarifying questions are answered.");
  return risks;
}

export interface PlanAgentCreationOptions {
  answers?: AgentDraftAnswers;
}

/** Assemble the full dry-run Agent Creation Plan. Pure — nothing is created. */
export function planAgentCreation(request: string, options: PlanAgentCreationOptions = {}): AgentCreationPlan {
  const draft = buildAgentDraft(request, options.answers ?? {});
  const classification = classifyRequest(request);
  const strategy = reviewStrategy(request);
  const recommendedSkills = recommendSkills(draft);
  const requiredCapabilities = requiredCapabilitiesFor(classification.buildTarget);
  const scaffoldPlan = planScaffold(draft, recommendedSkills);
  const providerPlan = planProviders(draft);

  const approvalGates = [
    "Hart approval of the spec + scaffold target",
    "ALLOW_AUTO_PROVISION (global provisioning gate — stays closed)",
    "CONFIRM_STAGING_PROVISION / CONFIRM_PRODUCTION_DEPLOY",
    ...providerPlan.filter((p) => p.mutation).map((p) => p.gate),
  ];

  const risks = domainRisks(draft, strategy);

  const doNotBuild: string[] = [];
  if (strategy.verdict === "DO_NOT_BUILD") doNotBuild.push(strategy.reason);
  if (strategy.verdict === "MERGE_WITH_EXISTING_AGENT") doNotBuild.push("Prefer merging into an existing agent rather than a new one.");
  if (strategy.simplerAlternative) doNotBuild.push(`Simpler alternative: ${strategy.simplerAlternative}`);

  const readyToPlanScaffold = draft.missingFields.length === 0;

  const summary =
    `Plan for \`${draft.name}\` — classified ${classification.classification} ` +
    `(domain ${classification.domain}, risk ${draft.riskLevel}). ` +
    `Strategy verdict: ${strategy.verdict} — ${strategy.reason} ` +
    `${requiredCapabilities.length} required capability(ies), ${recommendedSkills.length} recommended skill(s). ` +
    `${readyToPlanScaffold ? "Requirements complete." : `Need ${draft.missingFields.length} more detail(s).`} ` +
    `Scaffold + provisioning are PLANNED ONLY (dry-run) — nothing was created. Requires Hart approval.`;

  return {
    draft,
    classification,
    strategy,
    recommendedSkills,
    requiredCapabilities,
    scaffoldPlan,
    providerPlan,
    approvalGates,
    risks,
    doNotBuild,
    readyToPlanScaffold,
    summary,
  };
}
