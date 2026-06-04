/**
 * src/execution/local-scaffold-dryrun.ts
 *
 * Phase 17D — Local Scaffold Dry-Run From an Approved Plan.
 *
 * This is the Node EXECUTION-HOST side (per the Phase 17C architecture, see
 * docs/AGENT_CREATION_EXECUTION_PHASE17C.md): it runs only when a human invokes it, never on the
 * Worker request path. From a proposal that Hart has explicitly authorized
 * (`status === "approved_for_execution"`, Key 1), it produces LOCAL artifacts only — a spec draft,
 * the proposed repo structure, a `.env.example`, draft Supabase migration, draft Cloudflare config,
 * a provider plan, and a checklist — into a gitignored workdir, plus a CLOSED-GATE provision dry-run
 * report proving nothing would mutate.
 *
 * Hard boundaries (17D):
 *   - NO repo / Supabase project / Telegram bot creation. NO Cloudflare deploy. NO Trigger task.
 *   - NO `git push`, NO PR (that is 18A). NO provider network calls (the provision plan is built and
 *     gate-checked; the engine's verify()/apply() are NEVER invoked here).
 *   - NO real execution: the proposal is NOT advanced to executing/executed (that is 18B). 17D records
 *     an audit event and leaves the proposal at `approved_for_execution`.
 *   - NO secrets written: every artifact is secret-scanned before it touches disk; a hit fails closed.
 *   - NOT a Factory AgentConfig fork: the spec draft is plan-level. Canonical AgentConfig resolution +
 *     real file generation are the Agent Factory's job, wired in 18A (PR mode).
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { containsSecret } from "../llm/redaction.js";
import { resolveRef, appendAudit, deriveSpecId, type ProposalRef } from "../cockpit/proposals/proposal-queue.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { buildProvisionPlan, getDefaultAdapters } from "../provisioning/plan.js";
import { checkStepGate } from "../provisioning/gates.js";
import type { ProvisionStep } from "../provisioning/types.js";

export const DEFAULT_DRYRUN_DIR = "agent-scaffold-dryrun";

/** The subset of an `agent_creation_plan` proposal payload the dry-run consumes. */
interface AgentCreationPayload {
  request?: string;
  agentName?: string;
  classification?: string;
  domain?: string;
  strategyVerdict?: string;
  readyToPlanScaffold?: boolean;
  clarifyingQuestions?: string[];
  recommendedSkills?: string[];
  requiredCapabilities?: string[];
  scaffoldPlan?: Array<{ path: string; kind: "dir" | "file"; note: string }>;
  providerPlan?: Array<{ provider: string; reason: string; gate: string; mutation: boolean }>;
  approvalGates?: string[];
  risks?: string[];
  doNotBuild?: string[];
  summary?: string;
}

export interface ProviderDryRunStep {
  stepId: string;
  provider: string;
  action: string;
  mutation: boolean;
  /** "read_only" | "blocked_gate_closed" | "gate_open_not_run" */
  outcome: "read_only" | "blocked_gate_closed" | "gate_open_not_run";
  missingGates: string[];
  note: string;
}

export interface ProviderDryRunReport {
  agentName: string;
  environment: "local";
  totalSteps: number;
  mutatingSteps: number;
  blockedSteps: number;
  /** True iff NO mutating step could run (all gates closed) — the safe default. */
  allMutationsBlocked: boolean;
  steps: ProviderDryRunStep[];
}

export interface DryRunArtifact {
  /** Path relative to the dry-run workdir. */
  relPath: string;
  kind: "file";
  bytes: number;
}

export interface LocalScaffoldDryRunResult {
  specId: string;
  proposalId: string;
  agentName: string;
  /** Absolute path to the per-spec workdir. */
  outDir: string;
  artifacts: DryRunArtifact[];
  providerDryRun: ProviderDryRunReport;
  /** Always true — proven by scanning every artifact before write. */
  secretsClean: true;
  /** Always false — 17D is a dry-run; nothing was executed. */
  executed: false;
  /** Always true — the proposal stays at approved_for_execution (not advanced). */
  proposalUnchanged: true;
}

export interface LocalScaffoldDryRunOptions {
  cwd: string;
  ref: ProposalRef;
  now: string;
  /** Root for the gitignored dry-run workdir (default: agent-scaffold-dryrun/). */
  outRoot?: string;
  /** Gate env for the provision dry-run (default: process.env). Gates closed = mutations blocked. */
  env?: Record<string, string | undefined>;
}

export class DryRunPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DryRunPreconditionError";
  }
}

function asPayload(item: ProposalQueueItem): AgentCreationPayload {
  return (item.proposedPayload ?? {}) as AgentCreationPayload;
}

// ─── Artifact builders (pure string builders — scanned before any write) ─────────

function buildSpecDraft(item: ProposalQueueItem, specId: string, p: AgentCreationPayload): string {
  const spec = {
    specId,
    sourceProposalId: item.id,
    kind: "agent-creation-spec-draft",
    note:
      "PLAN-LEVEL draft only. The canonical Factory AgentConfig + byte-precise scaffold are resolved by " +
      "the Agent Factory in Phase 18A (PR mode) — this is NOT that artifact and is NOT committed to CC.",
    provisional: p.readyToPlanScaffold === false,
    agentName: p.agentName ?? "new-agent",
    purpose: p.request ?? "",
    domain: p.domain ?? "unknown",
    classification: p.classification ?? "unknown",
    strategyVerdict: p.strategyVerdict ?? "unknown",
    riskLevel: item.riskLevel,
    recommendedSkills: p.recommendedSkills ?? [],
    requiredCapabilities: p.requiredCapabilities ?? [],
    openQuestions: p.clarifyingQuestions ?? [],
  };
  return JSON.stringify(spec, null, 2) + "\n";
}

function buildStructure(p: AgentCreationPayload): string {
  const items = p.scaffoldPlan ?? [];
  const lines = [
    `# Proposed repo structure — ${p.agentName ?? "new-agent"} (DRY-RUN, nothing created)`,
    "",
    "Plan-level outline of what the Agent Factory would scaffold. No files are created here.",
    "",
    "```",
    ...items.map((i) => `${i.kind === "dir" ? "📁" : "📄"} ${i.path}    ${i.note}`),
    "```",
    "",
  ];
  return lines.join("\n");
}

function buildEnvExample(p: AgentCreationPayload): string {
  const lines = [
    `# .env.example — ${p.agentName ?? "new-agent"} (DRY-RUN draft; placeholders only, NO secrets)`,
    "# Fill these on the execution host only. They are never stored in the cockpit or a proposal.",
    "",
    "# ── Per-provider secrets (set on the Node execution host) ──",
  ];
  const providers = p.providerPlan ?? [];
  const seen = new Set<string>();
  for (const pr of providers) {
    if (seen.has(pr.provider)) continue;
    seen.add(pr.provider);
    switch (pr.provider) {
      case "github":
        lines.push("GITHUB_TOKEN=", "GITHUB_OWNER=", "GITHUB_REPO_NAME=");
        break;
      case "supabase":
        lines.push("SUPABASE_URL=", "SUPABASE_SERVICE_ROLE_KEY=  # host-only; never browser-exposed");
        break;
      case "cloudflare":
        lines.push("CLOUDFLARE_API_TOKEN=", "CLOUDFLARE_ACCOUNT_ID=");
        break;
      case "telegram":
        lines.push("TELEGRAM_BOT_TOKEN=");
        break;
      case "trigger":
        lines.push("TRIGGER_API_KEY=");
        break;
      case "openai":
        lines.push("OPENAI_API_KEY=");
        break;
      default:
        lines.push(`# ${pr.provider.toUpperCase()}_* (configure per provider)`);
    }
  }
  lines.push(
    "",
    "# ── Provisioning gates (Key 2). ALL DEFAULT CLOSED. Open only on the execution host, per provider. ──",
    "# ALLOW_AUTO_PROVISION=false",
    "# CONFIRM_STAGING_PROVISION=false",
    "# CONFIRM_PRODUCTION_DEPLOY=false",
    ...Array.from(new Set(providers.map((pr) => pr.gate))).map((g) => `# ${g}=false`),
    ""
  );
  return lines.join("\n");
}

function buildMigrationDraft(p: AgentCreationPayload): string {
  return [
    `-- DRAFT migration for ${p.agentName ?? "new-agent"} (DRY-RUN — NOT applied to any project)`,
    `-- Domain: ${p.domain ?? "unknown"}. Replace with the real schema during 18A review.`,
    "-- This is a placeholder outline only; no Supabase project is created or migrated in 17D.",
    "",
    "-- create table if not exists <entity> (",
    "--   id uuid primary key default gen_random_uuid(),",
    "--   created_at timestamptz not null default now()",
    "-- );",
    "",
  ].join("\n");
}

function buildWranglerDraft(p: AgentCreationPayload): string {
  const name = p.agentName ?? "new-agent";
  return [
    `# wrangler.cockpit.toml.example — ${name} (DRY-RUN draft; NOT deployed)`,
    `name = "${name}-cockpit"`,
    `main = "dist/runtime/cloudflare-cockpit-worker.js"`,
    `compatibility_date = "2024-01-01"`,
    `compatibility_flags = ["nodejs_compat"]`,
    "",
    "# Read-only hosted cockpit. Secrets are set via `wrangler secret put` on the host, never here.",
    "",
  ].join("\n");
}

function buildProviderPlanDoc(p: AgentCreationPayload, report: ProviderDryRunReport): string {
  const lines = [
    `# Provider provisioning plan — ${p.agentName ?? "new-agent"} (DRY-RUN)`,
    "",
    "Each provider step + the gate that blocks it. In 17D every mutating step is reported only;",
    "nothing is provisioned. Real provisioning is 18B, one gate at a time.",
    "",
    "| Step | Provider | Mutation | Outcome | Gate(s) |",
    "|---|---|---|---|---|",
    ...report.steps.map(
      (s) =>
        `| ${s.stepId} | ${s.provider} | ${s.mutation ? "yes" : "no"} | ${s.outcome} | ${s.missingGates.join(", ") || "—"} |`
    ),
    "",
    `All mutating steps blocked: **${report.allMutationsBlocked ? "yes (safe)" : "NO — a gate is open; 17D still does not run it"}**`,
    "",
  ];
  return lines.join("\n");
}

function buildChecklist(item: ProposalQueueItem, specId: string, p: AgentCreationPayload, report: ProviderDryRunReport): string {
  return [
    `# Approval checklist — ${p.agentName ?? "new-agent"}`,
    "",
    `- Spec id (durable): \`${specId}\``,
    `- Source proposal: \`${item.id}\``,
    `- Strategy verdict: ${p.strategyVerdict ?? "unknown"} · risk: ${item.riskLevel}`,
    `- Requirements complete: ${p.readyToPlanScaffold === false ? "NO — open questions remain" : "yes"}`,
    "",
    "## Two-key gate (17C)",
    "- [x] Key 1 — cockpit `approved_for_execution` (you authorized this dry-run)",
    "- [ ] Key 2 — host provisioning gates (ALL still closed; opened per-provider in 18B only)",
    "- [ ] A human runs the Node executor (this dry-run is that, in report-only mode)",
    "",
    "## Open questions to resolve before 18A",
    ...(p.clarifyingQuestions ?? []).map((q) => `- [ ] ${q}`),
    "",
    "## Risks / do-not-build",
    ...((p.risks ?? []).map((r) => `- ⚠️ ${r}`)),
    ...((p.doNotBuild ?? []).map((d) => `- ⛔ ${d}`)),
    "",
    "## Provider dry-run",
    `- ${report.mutatingSteps} mutating step(s); all blocked: ${report.allMutationsBlocked ? "yes" : "NO"}.`,
    "",
    "## Next (gated, future)",
    "- 18A — scaffold → branch → **PR** (always PR; no local-commit bypass) → your review → merge. No provider mutation.",
    "- 18B — open `ALLOW_*` gates one provider at a time: dry-run → apply → ledger → smoke → rollback-ready.",
    "",
  ].join("\n");
}

// ─── Provider dry-run (build plan + gate-check; engine verify()/apply() NEVER called) ──

async function buildProviderDryRun(
  agentName: string,
  env: Record<string, string | undefined>
): Promise<ProviderDryRunReport> {
  const adapters = await getDefaultAdapters();
  const plan = await buildProvisionPlan({ agentName, environment: "local", env }, adapters);
  const steps: ProviderDryRunStep[] = plan.steps.map((step: ProvisionStep) => {
    if (!step.mutation) {
      return {
        stepId: step.id,
        provider: step.provider,
        action: step.action,
        mutation: false,
        outcome: "read_only",
        missingGates: [],
        note: "Read-only step — would verify; not run in dry-run.",
      };
    }
    const gate = checkStepGate(step, env);
    return {
      stepId: step.id,
      provider: step.provider,
      action: step.action,
      mutation: true,
      outcome: gate.allowed ? "gate_open_not_run" : "blocked_gate_closed",
      missingGates: gate.missingGates,
      note: gate.allowed
        ? "Gate OPEN — would mutate in 18B; NOT run in 17D (dry-run only)."
        : "Blocked: required gate is closed.",
    };
  });
  const mutating = steps.filter((s) => s.mutation);
  const blocked = mutating.filter((s) => s.outcome === "blocked_gate_closed");
  return {
    agentName,
    environment: "local",
    totalSteps: steps.length,
    mutatingSteps: mutating.length,
    blockedSteps: blocked.length,
    allMutationsBlocked: mutating.length > 0 && blocked.length === mutating.length,
    steps,
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Produce local dry-run artifacts from an APPROVED-FOR-EXECUTION agent-creation proposal.
 * Throws DryRunPreconditionError if the proposal is missing, of the wrong type, or not authorized.
 */
export async function runLocalScaffoldDryRun(opts: LocalScaffoldDryRunOptions): Promise<LocalScaffoldDryRunResult> {
  const { cwd, ref, now } = opts;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);

  const item = await resolveRef(cwd, ref);
  if (!item) throw new DryRunPreconditionError("Proposal not found.");
  if (item.actionType !== "agent_creation_plan") {
    throw new DryRunPreconditionError(`Dry-run only supports agent_creation_plan, got "${item.actionType}".`);
  }
  // Key 1 — must be explicitly authorized. A prompt cannot reach this: only an authorized proposal
  // (set via the cockpit/approve CLI) plus a human running this Node executor gets here.
  if (item.status !== "approved_for_execution") {
    throw new DryRunPreconditionError(
      `Proposal must be approved_for_execution (was "${item.status}"). Authorize it first (Key 1).`
    );
  }

  const p = asPayload(item);
  const specId = item.specId ?? deriveSpecId(item);
  const agentName = p.agentName ?? "new-agent";
  const outRoot = opts.outRoot ?? DEFAULT_DRYRUN_DIR;
  const outDir = path.join(cwd, outRoot, specId);

  const providerDryRun = await buildProviderDryRun(agentName, env);

  // Build every artifact's content first, secret-scan ALL of it, then write — fail closed.
  const providers = p.providerPlan ?? [];
  const has = (name: string) => providers.some((pr) => pr.provider === name);

  const planned: Array<{ relPath: string; content: string }> = [
    { relPath: "agent-spec-draft.json", content: buildSpecDraft(item, specId, p) },
    { relPath: "STRUCTURE.md", content: buildStructure(p) },
    { relPath: ".env.example", content: buildEnvExample(p) },
    { relPath: "provider-plan.md", content: buildProviderPlanDoc(p, providerDryRun) },
    { relPath: "CHECKLIST.md", content: buildChecklist(item, specId, p, providerDryRun) },
  ];
  if (has("supabase")) {
    planned.push({ relPath: "supabase/migrations/0001_DRAFT_schema.sql", content: buildMigrationDraft(p) });
  }
  if (has("cloudflare")) {
    planned.push({ relPath: "wrangler.cockpit.toml.example", content: buildWranglerDraft(p) });
  }

  for (const a of planned) {
    if (containsSecret(a.content)) {
      throw new DryRunPreconditionError(`Refusing to write dry-run artifact ${a.relPath}: secret-looking content.`);
    }
  }

  const artifacts: DryRunArtifact[] = [];
  for (const a of planned) {
    const full = path.join(outDir, a.relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, a.content, "utf8");
    artifacts.push({ relPath: a.relPath, kind: "file", bytes: Buffer.byteLength(a.content, "utf8") });
  }

  // Record the dry-run on the proposal WITHOUT advancing its status (still approved_for_execution).
  await appendAudit(
    cwd,
    { id: item.id },
    "local_scaffold_dryrun",
    now,
    `specId=${specId}; ${artifacts.length} local artifacts; ${providerDryRun.mutatingSteps} mutating step(s), all blocked=${providerDryRun.allMutationsBlocked}; nothing executed`
  );

  return {
    specId,
    proposalId: item.id,
    agentName,
    outDir,
    artifacts,
    providerDryRun,
    secretsClean: true,
    executed: false,
    proposalUnchanged: true,
  };
}
