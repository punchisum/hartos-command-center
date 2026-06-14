/**
 * src/agents/meta-agent-registry.ts — the canonical META-AGENT / ORGAN REGISTRY (Live Organism P1).
 *
 * ONE Worker-safe source of truth describing the whole HartOS organism: every meta-agent + system
 * organ, its role, hierarchy, dependencies, supported intents, capability surface, and — honestly —
 * whether it is cockpit-callable, CLI-only, requires a local runner, requires approval, and its
 * current status (live / partial / local_only / unavailable / stale) with a reason.
 *
 * This is DECLARATIVE org knowledge (not derivable from the scattered seams), so the catalog is
 * hand-authored and kept honest. The org panel (P2), command router (P3/P4), and status split (P10)
 * all read from here. PURE: no fs / pg / network / clock (now is injected). Never mutates.
 *
 * Doctrine: it DESCRIBES; it never executes. cockpit_callable means "the cockpit can invoke its
 * read-only/propose surface", NOT "it can mutate" — execution stays gated + approval-bound.
 */

export type MetaAgentCategory =
  | "human"
  | "command"
  | "perception"
  | "immune"
  | "scout"
  | "research"
  | "forecast"
  | "factory"
  | "quality_gate"
  | "simulation"
  | "domain"
  | "memory"
  | "organ";

/**
 * The catalog's EXPECTED lifecycle status (hand-authored). This is expectation, NOT measured
 * reality — the truth layer (GET /api/liveness, computeFleetVerdict) derives actual liveness from
 * evidence, and the v5 cockpit's fleet-health figure is computed, not counted from these. Treat as
 * "what this node should be," shown alongside the computed truth, never as the live truth itself.
 */
export type AgentStatus = "live" | "partial" | "local_only" | "unavailable" | "stale";

/** How much authority the node carries — the safety tier. */
export type SafetyTier = "human" | "read_only" | "propose_only" | "gated_execute";

export interface MetaAgent {
  id: string;
  displayName: string;
  category: MetaAgentCategory;
  role: string;
  description: string;
  /** Hierarchy parent (org chart). null = root (Hart). */
  parentId: string | null;
  reportsTo: string | null;
  dependsOn: string[];
  supportedIntents: string[];
  commandExamples: string[];
  inputContract: string;
  outputContract: string;
  readOnlyCapabilities: string[];
  proposalCapabilities: string[];
  executionCapabilities: string[];
  cockpitCallable: boolean;
  cliOnly: boolean;
  requiresLocalRunner: boolean;
  requiresApproval: boolean;
  safetyTier: SafetyTier;
  status: AgentStatus;
  statusReason: string;
  /** Source modules implementing it (links, not imports). */
  sourceModules: string[];
  isOrgan: boolean;
}

export interface MetaRegistryCounts {
  total: number;
  cockpitCallable: number;
  cliOnly: number;
  localRunner: number;
  live: number;
  partial: number;
  unavailable: number;
}

export interface MetaAgentRegistry {
  generatedAt: string | null;
  /** Root node id (the human approval gate). */
  rootId: string;
  agents: MetaAgent[];
  byId: Record<string, MetaAgent>;
  counts: MetaRegistryCounts;
}

// ── The canonical catalog (honest as of the Live Organism Patch) ────────────────

const CATALOG: MetaAgent[] = [
  {
    id: "hart",
    displayName: "Hart (Human)",
    category: "human",
    role: "Approval gate + intent source",
    description: "The operator. States outcomes, approves gated actions. The permanent human-approval floor — no mutation ships without Hart.",
    parentId: null,
    reportsTo: null,
    dependsOn: [],
    supportedIntents: ["approve", "reject", "command"],
    commandExamples: ["approve this proposal", "reject the aging drafts"],
    inputContract: "—",
    outputContract: "approval decisions",
    readOnlyCapabilities: ["see everything"],
    proposalCapabilities: [],
    executionCapabilities: ["approve/reject proposals"],
    cockpitCallable: false,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "human",
    status: "live",
    statusReason: "The human in the loop.",
    sourceModules: [],
    isOrgan: false,
  },
  {
    id: "orchestrator",
    displayName: "HartOS Command / Orchestrator",
    category: "command",
    role: "The control brain + command surface",
    description: "Receives natural-language intent, classifies it, routes to the right agent/organ, and composes the answer. Ask HartOS is its voice.",
    parentId: "hart",
    reportsTo: "hart",
    dependsOn: ["rinnegan", "executive-memory", "supabase"],
    supportedIntents: ["read_only_intelligence", "meta_agent_invocation", "mutation_request", "organisation"],
    commandExamples: ["what should I focus on today?", "show me my agents", "what can HartOS do right now?"],
    inputContract: "natural-language request",
    outputContract: "routed answer + selected agent + gated proposals",
    readOnlyCapabilities: ["classify intent", "route to agents", "answer from state/vault/memory"],
    proposalCapabilities: ["emit gated proposals from a request"],
    executionCapabilities: [],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "propose_only",
    status: "live",
    statusReason: "Deployed /api/ask; LLM-enriched when the gateway is armed, deterministic + honest otherwise.",
    sourceModules: ["src/llm/ask-llm.ts", "src/hartos/orchestrator.ts", "src/cockpit/command-router.ts"],
    isOrgan: false,
  },
  {
    id: "rinnegan",
    displayName: "Rinnegan",
    category: "perception",
    role: "Context compiler / perception",
    description: "Assembles a ranked, freshness-tagged briefing from vault dossiers + live facts + memory patterns so the Ask reasons over MEANING, not just facts. Also cross-system perception (drift, blind spots).",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["obsidian", "supabase", "executive-memory"],
    supportedIntents: ["context_compile", "perception"],
    commandExamples: ["what context are you using?", "rinnegan compile <intent>"],
    inputContract: "intent + notes/facts/patterns",
    outputContract: "compiled briefing pack (ranked, freshness-tagged)",
    readOnlyCapabilities: ["compile context", "perceive drift/blind-spots"],
    proposalCapabilities: [],
    executionCapabilities: [],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "live",
    statusReason: "Compiles in-Worker for /api/ask from the synced context pack.",
    sourceModules: ["src/rinnegan/rinnegan-compiler.ts", "src/rinnegan/perception.ts", "src/rinnegan/briefing-pack.ts"],
    isOrgan: false,
  },
  {
    id: "wolverine",
    displayName: "Wolverine",
    category: "immune",
    role: "Immune system / auditor",
    description: "Audits HartOS itself + the fleet (unsafe flags, git hygiene, stale data, doctrine drift, proposal/capability risk). Diagnoses automatically; repairs are approval-gated FixProposals. Detects, ranks, proposes, verifies — never the builder.",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["supabase", "obsidian"],
    supportedIntents: ["system_audit", "cockpit_audit", "repo_hygiene", "proposal_hygiene"],
    commandExamples: ["wolverine, audit the cockpit", "what is wolverine seeing?", "what's broken?"],
    inputContract: "env + git + proposal stats + vault notes + capability scouts",
    outputContract: "GREEN/AMBER/RED verdict + ranked repair queue + gated FixProposals",
    readOnlyCapabilities: ["system audit", "ranked repair plan"],
    proposalCapabilities: ["generate gated FixProposals"],
    executionCapabilities: [],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: true,
    requiresApproval: false,
    safetyTier: "propose_only",
    status: "live",
    statusReason: "Self-audit + ranked FixProposal repair loop is LIVE — detects on every pulse and proposes fixes (propose-only; gated hands). Full git/fs audit runs on the local runner. Last baseline: GREEN.",
    sourceModules: ["src/wolverine/wolverine-audit.ts", "scripts/wolverine-audit.ts"],
    isOrgan: false,
  },
  {
    id: "sentinel",
    displayName: "Sentinel",
    category: "immune",
    role: "Fleet heartbeat / liveness monitor",
    description: "Continuously answers 'is every agent alive?' — folds the registry with real evidence (artifacts, read-model rows, pulse runs, the answering Worker) into per-agent up/stale/down/unknown verdicts. Detects only; a silent agent becomes a Wolverine finding + gated FixProposal, never an auto-restart.",
    parentId: "wolverine",
    reportsTo: "wolverine",
    dependsOn: [],
    supportedIntents: ["fleet_liveness", "agent_heartbeat"],
    commandExamples: ["are all agents up?", "who went silent?", "fleet heartbeat"],
    inputContract: "meta-agent registry + host-gathered heartbeats (evidence timestamps)",
    outputContract: "per-agent liveness verdicts + GREEN/AMBER/RED fleet rollup",
    readOnlyCapabilities: ["fleet liveness assessment"],
    proposalCapabilities: ["liveness findings feed Wolverine FixProposals"],
    executionCapabilities: [],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "live",
    statusReason: "Pure core runs in-Worker (/api/liveness) and locally (npm run sentinel:status); evidence coverage grows as heartbeat sources are wired.",
    sourceModules: ["src/sentinel/sentinel-liveness.ts", "src/wolverine/detectors/agent-liveness.ts", "scripts/sentinel-status.ts"],
    isOrgan: false,
  },
  {
    id: "prophet",
    displayName: "Prophet",
    category: "forecast",
    role: "Forecaster (consequence of inaction)",
    description: "Projects the logical consequence of leaving known issues unaddressed — data rot, capability gaps, aging proposals, capability-scout traps. Honest confidence; never a horoscope.",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["wolverine", "executive-memory", "rinnegan"],
    supportedIntents: ["forecast"],
    commandExamples: ["prophet, what will bite us next?", "what's degrading?"],
    inputContract: "perception + plan + wolverine + memory + capability scouts",
    outputContract: "ranked consequences (severity/horizon) + honest confidence",
    readOnlyCapabilities: ["consequence-of-inaction forecast"],
    proposalCapabilities: [],
    executionCapabilities: [],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "live",
    statusReason: "Runs in-Worker for the cockpit page; memory-trend depth needs ≥3 snapshots (currently accruing).",
    sourceModules: ["src/prophet/forecast.ts", "scripts/prophet-forecast.ts"],
    isOrgan: false,
  },
  {
    id: "executive-memory",
    displayName: "Executive Memory",
    category: "memory",
    role: "Pattern memory across time",
    description: "Durable compact snapshots → recurring patterns, trends, lessons. The only layer that sees across time. Needs ≥3 snapshots before patterns are earned (honesty floor).",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["supabase"],
    supportedIntents: ["recall_patterns", "trends"],
    commandExamples: ["what patterns have repeated?", "show executive memory"],
    inputContract: "compact daily snapshots",
    outputContract: "recurring patterns + trends + lessons (or honest INSUFFICIENT_HISTORY)",
    readOnlyCapabilities: ["recall patterns/trends"],
    proposalCapabilities: [],
    executionCapabilities: ["capture snapshot (gated heartbeat)"],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: true,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "partial",
    statusReason: "Durable store live; daily capture is a local/scheduled runner. INSUFFICIENT_HISTORY until ≥3 snapshots.",
    sourceModules: ["src/awareness/executive-memory.ts", "src/awareness/supabase-memory-store.ts", "scripts/cockpit-memory-capture.ts"],
    isOrgan: false,
  },
  {
    id: "research",
    displayName: "Research Agent",
    category: "research",
    role: "Deep-research analyst",
    description: "Plans a scoped inquiry, gathers sources (gated web/LLM), synthesizes cited key findings into reusable knowledge, files a gated dossier. Never fabricates — unknowns stay unknowns.",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["rinnegan", "obsidian", "orchestrator"],
    supportedIntents: ["research_brief", "dossier_summary"],
    commandExamples: ["research agent, summarize the war/economy dossier", "research X"],
    inputContract: "a scoped question (+ gated gather: network + LLM)",
    outputContract: "ResearchDossier → gated research_dossier vault note",
    readOnlyCapabilities: ["summarize existing dossiers"],
    proposalCapabilities: ["propose a dossier note (gated vault write)"],
    executionCapabilities: ["gather + synthesize (local runner, gated)"],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: true,
    requiresApproval: true,
    safetyTier: "propose_only",
    status: "partial",
    statusReason: "Cockpit summarizes existing dossiers from the pack; a NEW research run needs a local runner (gated network+LLM). Proven live (67-source war/economy brief).",
    sourceModules: ["src/research/research-synthesis.ts", "src/research/research-gatherer.ts", "scripts/research-run.ts"],
    isOrgan: false,
  },
  {
    id: "beezulbub",
    displayName: "Beezulbub",
    category: "scout",
    role: "OSS capability scout",
    description: "Scouts external repos for capabilities to absorb, rejects poison/risky licenses, files a gated capability dossier. LLM-deepened due-diligence. Acquisition, not authority — never auto-copies code.",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["obsidian", "orchestrator"],
    supportedIntents: ["capability_hunt", "capability_summary", "capability_digest"],
    commandExamples: ["beezulbub, what should we absorb for markdown editing?", "show capability dossiers"],
    inputContract: "a capability target (+ gated GitHub network for live hunt)",
    outputContract: "ranked candidates → gated capability_dossier vault note",
    readOnlyCapabilities: ["summarize existing capability dossiers"],
    proposalCapabilities: ["propose a capability dossier (gated vault write)"],
    executionCapabilities: ["live GitHub hunt (local runner, gated)"],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: true,
    requiresApproval: true,
    safetyTier: "propose_only",
    status: "live",
    statusReason: "OSS capability scout is LIVE — hunts run on the local runner behind the gated GitHub token; the cockpit summarizes scouts from the pack. Proven live (markdown_editor → 10 repos).",
    sourceModules: ["src/beezulbub/scout.ts", "src/beezulbub/capability-dossier-note.ts", "scripts/beezulbub-hunt.ts"],
    isOrgan: false,
  },
  {
    id: "factory",
    displayName: "Agent Factory",
    category: "factory",
    role: "Agent builder (config, not code)",
    description: "Interrogates a request into a locked AgentSpec, compiles a manifest of known runtime patterns, officiates + simulates, emits a gated build/provision proposal. No live provisioning without Hart.",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["officiator", "simulator", "execution-engine"],
    supportedIntents: ["agent_creation", "agent_plan"],
    commandExamples: ["factory, plan a new tax agent", "create an agent for X"],
    inputContract: "agent request → AgentSpec → AgentManifest",
    outputContract: "officiation outcome + gated persist/provision proposal",
    readOnlyCapabilities: ["plan/compile an agent spec+manifest"],
    proposalCapabilities: ["gated build/provision proposal"],
    executionCapabilities: ["provision (gated, Hart-approved, local runner)"],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: true,
    requiresApproval: true,
    safetyTier: "propose_only",
    status: "live",
    statusReason: "Plan→officiate→simulate→PR→gated provisioning is LIVE — builds agents end-to-end on the local runner behind Hart's approval + the §6/kill-switch gate. Proven (autonomous fix→deploy e073ceb).",
    sourceModules: ["src/hartos/factory-officiator.ts", "src/hartos/manifest-compiler.ts", "src/hartos/spec-interrogator.ts"],
    isOrgan: false,
  },
  {
    id: "officiator",
    displayName: "Officiator",
    category: "quality_gate",
    role: "Quality gate / judge",
    description: "Scores a born agent's manifest across 9 facets (officiation, tests, observability, boundary, acceptance, failure mode, doctrine, risk gate, non-duplication) → ADMIT / REVISE / REJECT.",
    parentId: "factory",
    reportsTo: "factory",
    dependsOn: [],
    supportedIntents: ["agent_review"],
    commandExamples: ["review this agent", "officiate the spec"],
    inputContract: "AgentManifest + officiation outcome",
    outputContract: "AgentQualityVerdict (ADMIT/REVISE/REJECT + scorecard)",
    readOnlyCapabilities: ["score + verdict an agent"],
    proposalCapabilities: [],
    executionCapabilities: [],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "live",
    statusReason: "Pure quality gate; runs wherever the factory pipeline runs.",
    sourceModules: ["src/hartos/officiator-quality-gate.ts"],
    isOrgan: false,
  },
  {
    id: "simulator",
    displayName: "Simulator / Replay",
    category: "simulation",
    role: "Behavioral rehearsal",
    description: "Replays scenarios through a born agent's OWN boundary using the live boundary gate — proves the boundary bites before admission. Auto-derives happy + red-team cases.",
    parentId: "factory",
    reportsTo: "factory",
    dependsOn: [],
    supportedIntents: ["agent_simulate"],
    commandExamples: ["simulate this agent", "replay the spec"],
    inputContract: "AgentManifest (+ optional scenarios)",
    outputContract: "SimulationReport (PASS/FAIL, boundary bites)",
    readOnlyCapabilities: ["replay scenarios through the boundary"],
    proposalCapabilities: [],
    executionCapabilities: [],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "live",
    statusReason: "Pure simulator; runs wherever the factory pipeline runs.",
    sourceModules: ["src/hartos/agent-simulator.ts"],
    isOrgan: false,
  },
  {
    id: "execution-engine",
    displayName: "Execution Engine / Mutation Spine",
    category: "organ",
    role: "Gated hands",
    description: "The ONLY path that mutates external state (ClickUp comment/move, reject/archive proposals, refresh-sync). Fail-closed: capability token + allowlist + kill-switch + audit; default OFF.",
    parentId: "factory",
    reportsTo: "orchestrator",
    dependsOn: ["supabase"],
    supportedIntents: ["execute_approved"],
    commandExamples: ["(via approved proposals only)"],
    inputContract: "an approved_for_execution proposal + capability token",
    outputContract: "executed mutation + audit entry + StateDelta",
    readOnlyCapabilities: [],
    proposalCapabilities: [],
    executionCapabilities: ["dispatch gated mutation adapters"],
    cockpitCallable: false,
    cliOnly: true,
    requiresLocalRunner: true,
    requiresApproval: true,
    safetyTier: "gated_execute",
    status: "partial",
    statusReason: "Proven live (canary) but DEFAULT OFF; fires only on an approved proposal via a local runner. The cockpit never executes directly.",
    sourceModules: ["src/execution/execution-dispatch.ts", "src/execution/approved-executor.ts", "scripts/run-mutation.ts"],
    isOrgan: true,
  },
  {
    id: "fitness",
    displayName: "Fitness Agent",
    category: "domain",
    role: "Recovery / training / nutrition",
    description: "Reads Apple Health / wearable data, coaches training & recovery, surfaces an advisory verdict. Read-only + advisory (no approval gate).",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["supabase"],
    supportedIntents: ["fitness_status", "fitness_advice"],
    commandExamples: ["how's my recovery?", "what should today's session be?"],
    inputContract: "fitness read-model (Supabase RPC)",
    outputContract: "banded fitness signal + coach advice",
    readOnlyCapabilities: ["recovery/training read + coach advice"],
    proposalCapabilities: ["fitness adjustment plan (advisory)"],
    executionCapabilities: [],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "live",
    statusReason: "Live read-model; today's state resolved (read-only RPC).",
    sourceModules: ["src/fitness/coaching-core.ts", "src/read-models/agent-detail.ts"],
    isOrgan: false,
  },
  {
    id: "ops",
    displayName: "Ops Agent",
    category: "domain",
    role: "Business execution (ClickUp)",
    description: "Reads ClickUp task cards (active / waiting / blocked / stale), triages risks + quick wins, proposes follow-ups. NOT DevOps/SRE.",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["supabase", "execution-engine"],
    supportedIntents: ["ops_status", "ops_followup"],
    commandExamples: ["anything urgent in ops?", "what's stalled?"],
    inputContract: "ops read-model (Supabase RPC)",
    outputContract: "triage (risks/opportunities) + ops follow-up proposals",
    readOnlyCapabilities: ["ops triage read"],
    proposalCapabilities: ["ops follow-up plan", "sync repair plan"],
    executionCapabilities: ["ClickUp comment/move (gated, via execution engine)"],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: true,
    safetyTier: "propose_only",
    status: "live",
    statusReason: "Ops read-model LIVE — the 5 read-only RPCs (overview/status-counts/risk-flags/attention-cards/recent-updates) resolve from the GECAN Ops Panel (ops-agent-v2 Supabase); 10 ClickUp cards triaged read-only.",
    sourceModules: ["src/ops/triage-core.ts", "src/read-models/agent-detail.ts"],
    isOrgan: false,
  },
  {
    id: "supabase",
    displayName: "Supabase / State Store",
    category: "organ",
    role: "Facts / state / audit",
    description: "The fact layer: read-models, proposal spine, executive memory, context pack. Read-only from the cockpit (anon keys); writes go through gated Node runners.",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: [],
    supportedIntents: [],
    commandExamples: ["(read-only data source)"],
    inputContract: "—",
    outputContract: "read-model facts + proposal/memory/context tables",
    readOnlyCapabilities: ["serve read-models + context pack (anon)"],
    proposalCapabilities: [],
    executionCapabilities: ["persist proposals/memory (gated Node runner)"],
    cockpitCallable: false,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "live",
    statusReason: "Read-only anon access live; fitness project healthy, ops project returning 401.",
    sourceModules: ["src/read-models/supabase-read-client.ts", "src/runtime/cloudflare-live-read-models.ts"],
    isOrgan: true,
  },
  {
    id: "obsidian",
    displayName: "Obsidian / Vault",
    category: "organ",
    role: "Meaning / knowledge",
    description: "The meaning layer: human-readable dossiers + doctrine + MOCs in a local vault, mirrored to Supabase for the deployed Ask (Rinnegan). Gated, approval-bound writes; nothing deleted.",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["supabase"],
    supportedIntents: ["knowledge_read"],
    commandExamples: ["show research dossiers", "what do we know about X?"],
    inputContract: "gated ObsidianNoteProposal",
    outputContract: "vault notes (local) → context pack mirror (deployed Ask)",
    readOnlyCapabilities: ["serve dossiers/knowledge to Rinnegan"],
    proposalCapabilities: ["gated note proposals"],
    executionCapabilities: ["local vault write (gated) + sync-pack (local runner)"],
    cockpitCallable: false,
    cliOnly: false,
    requiresLocalRunner: true,
    requiresApproval: true,
    safetyTier: "propose_only",
    status: "local_only",
    statusReason: "Vault is local; mirrored to Supabase via rinnegan:sync-pack (local runner). The deployed Ask reads the mirror.",
    sourceModules: ["src/obsidian/obsidian-writer.ts", "src/rinnegan/vault-reader.ts", "scripts/rinnegan-sync-pack.ts"],
    isOrgan: true,
  },
  {
    id: "cockpit",
    displayName: "Cockpit",
    category: "organ",
    role: "Command surface",
    description: "The hosted, auth-gated control surface where Hart sees the fleet + issues intent. Honest about staleness; read-only + propose-only (never executes directly).",
    parentId: "orchestrator",
    reportsTo: "orchestrator",
    dependsOn: ["orchestrator", "supabase"],
    supportedIntents: ["render", "ask", "approve"],
    commandExamples: ["(the UI itself)"],
    inputContract: "auth + request",
    outputContract: "rendered cockpit + Ask answers + gated approve/reject",
    readOnlyCapabilities: ["render fleet/knowledge/intelligence"],
    proposalCapabilities: ["surface proposals for approval"],
    executionCapabilities: ["relay approve/reject to the gated spine"],
    cockpitCallable: true,
    cliOnly: false,
    requiresLocalRunner: false,
    requiresApproval: false,
    safetyTier: "read_only",
    status: "live",
    statusReason: "Deployed Cloudflare Worker (read-only; actionExecution disabled).",
    sourceModules: ["src/runtime/cloudflare-cockpit-worker.ts", "src/runtime/cloudflare-cockpit-page.ts"],
    isOrgan: true,
  },
];

/**
 * Capability agents whose hands are gated by the global kill-switch. Their badge is "live"
 * (the capability is built + proven), but a thrown kill-switch HONESTLY downgrades them — the
 * one piece of arming state the read-only cockpit can actually observe.
 */
const KILL_SWITCH_GATED_AGENTS = new Set<string>(["wolverine", "beezulbub", "factory", "execution-engine"]);

/**
 * Resolve the canonical meta-agent registry — pure + deterministic. `now` is injected (no clock).
 * `env` is optional: when the global kill-switch (HARTOS_EXECUTION_KILL_SWITCH=on) is set, the
 * gated capability agents are downgraded to "partial" with an honest reason, so the cockpit badge
 * derives from real arming state instead of always claiming "live".
 * The output is frozen (read-only; the registry describes, it never mutates).
 */
export function resolveMetaAgentRegistry(
  opts: { now?: string; env?: Record<string, string | undefined> } = {},
): MetaAgentRegistry {
  const killSwitchOn = String(opts.env?.["HARTOS_EXECUTION_KILL_SWITCH"] ?? "").trim().toLowerCase() === "on";
  const agents = CATALOG.map((a) => {
    if (killSwitchOn && a.status === "live" && KILL_SWITCH_GATED_AGENTS.has(a.id)) {
      return Object.freeze({
        ...a,
        status: "partial" as const,
        statusReason: `DISARMED by the global kill-switch (HARTOS_EXECUTION_KILL_SWITCH=on). Capability intact — ${a.statusReason}`,
      });
    }
    return Object.freeze({ ...a });
  });
  const byId: Record<string, MetaAgent> = {};
  for (const a of agents) byId[a.id] = a;
  const counts: MetaRegistryCounts = {
    total: agents.length,
    cockpitCallable: agents.filter((a) => a.cockpitCallable).length,
    cliOnly: agents.filter((a) => a.cliOnly).length,
    localRunner: agents.filter((a) => a.requiresLocalRunner).length,
    live: agents.filter((a) => a.status === "live").length,
    partial: agents.filter((a) => a.status === "partial").length,
    unavailable: agents.filter((a) => a.status === "unavailable").length,
  };
  return Object.freeze({ generatedAt: opts.now ?? null, rootId: "hart", agents, byId, counts });
}

/** Direct children of a node in the org hierarchy (deterministic order = catalog order). */
export function childrenOf(reg: MetaAgentRegistry, id: string): MetaAgent[] {
  return reg.agents.filter((a) => a.parentId === id);
}
