/**
 * src/cockpit/command-router.ts — the COCKPIT COMMAND ROUTER (Live Organism P3/P4).
 *
 * Deterministic, PURE, Worker-safe intent routing: given a natural-language request, decide which
 * meta-agent/mode handles it and HOW HartOS should respond — answer directly (read-only), create a
 * gated proposal/job, or return an honest "requires local runner" (never silent execution, never a
 * faked capability). The registry (meta-agent-registry) supplies each agent's honest capability
 * surface (cockpit_callable / requires_local_runner / status), so routing reflects reality.
 *
 * This is the deterministic backbone; an LLM may refine the answer downstream, but the AGENT
 * SELECTION + safety posture here are rule-based and testable. Fail-closed: an unrecognised or
 * unsafe request routes to "unknown" with an honest fallback, never a fabricated action.
 */

import { resolveMetaAgentRegistry, type MetaAgentRegistry, type MetaAgent, type AgentStatus } from "../agents/meta-agent-registry.js";

export type IntentClass =
  | "read_only_intelligence"
  | "meta_agent_invocation"
  | "mutation_action"
  | "organisation"
  | "unknown";

export interface RoutingDecision {
  request: string;
  intentClass: IntentClass;
  selectedAgentId: string | null;
  selectedAgentName: string | null;
  /** e.g. "answer" | "summary" | "audit" | "hunt" | "forecast" | "context" | "create" | "organisation". */
  selectedMode: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  /** Can the cockpit answer this read-only, right now, from state/vault/memory/dossiers? */
  directAnswerPossible: boolean;
  /** Should this become a gated proposal/job (an action request)? */
  needsProposal: boolean;
  needsApproval: boolean;
  /** Honest: the live action needs a local CLI / Trigger / network runner the Worker can't run. */
  requiresLocalRunner: boolean;
  capabilityStatus: AgentStatus | "n/a";
  /** Honest next step when direct answer isn't possible (a command or a "requires runner" note). */
  fallback: string;
}

const MUTATION_RE = /\b(approve|reject|archive|expire|run\s+sync|sync\s+now|refresh[\s-]?sync|execute|deploy|provision|mutate|delete|move\s+(the\s+)?card|comment\s+on)\b/i;
const CREATE_AGENT_RE = /\b(create|build|plan|spec|make)\b[^.?!]*\bagent\b/i;
const ORG_RE = /\b(org(?:ani[sz]ation)?\s*(chart|structure)?|show\s+(me\s+)?(my\s+)?agents|which\s+agents|agents?\s+(are\s+)?(alive|live|cli|cli-only|callable)|fleet\s+(chart|structure)|command\s+structure|meta[- ]?agents?)\b/i;
const CAPABILITIES_RE = /\b(what\s+can\s+hartos\s+do|what\s+can\s+you\s+do|capabilities?\s+(do\s+you|of\s+hartos)|what'?s\s+cli[- ]?only)\b/i;

/** A keyword→agent matcher with a read-only vs action discriminator. */
interface AgentMatcher {
  agentId: string;
  /** request matches this agent. */
  match: RegExp;
  /** within the agent, this marks a read-only (summary/status) intent vs an action. */
  readOnly: RegExp;
  readOnlyMode: string;
  actionMode: string;
}

const MATCHERS: AgentMatcher[] = [
  { agentId: "wolverine", match: /\bwolverine\b|system\s+audit|cockpit\s+audit|what'?s\s+broken|repo\s+hygiene/i, readOnly: /\b(what|show|latest|verdict|seeing|status)\b/i, readOnlyMode: "verdict", actionMode: "audit" },
  { agentId: "beezulbub", match: /\bbeezulbub\b|capability\s+(scout|dossier|hunt)|capability\s+dossiers|\babsorb\b|open[- ]?source\s+(for|to)/i, readOnly: /\b(show|what\s+did|summari[sz]e|list|which)\b/i, readOnlyMode: "summary", actionMode: "hunt" },
  { agentId: "research", match: /\bresearch\b|\bdossier\b|research\s+report|war\/?\s*economy/i, readOnly: /\b(show|summari[sz]e|what\s+do\s+we\s+know|list|recall)\b/i, readOnlyMode: "summary", actionMode: "brief" },
  { agentId: "prophet", match: /\bprophet\b|\bforecast\b|what\s+will\s+bite|what'?s\s+degrading|consequence/i, readOnly: /.*/i, readOnlyMode: "forecast", actionMode: "forecast" },
  { agentId: "rinnegan", match: /\brinnegan\b|what\s+context|context\s+(pack|are\s+you)/i, readOnly: /.*/i, readOnlyMode: "context", actionMode: "context" },
  { agentId: "factory", match: /\bfactory\b|create\s+(a|an)?\s*\w+\s*agent|plan\s+(a|an)?\s*\w*\s*agent|new\s+agent/i, readOnly: /\b(show|list|status)\b/i, readOnlyMode: "status", actionMode: "create" },
  { agentId: "executive-memory", match: /\bexecutive\s+memory\b|\bpatterns?\b|\btrends?\b|what\s+(has\s+)?recurred/i, readOnly: /.*/i, readOnlyMode: "recall", actionMode: "recall" },
  { agentId: "fitness", match: /\bfitness\b|recovery|workout|training|sleep|nutrition|hrv/i, readOnly: /.*/i, readOnlyMode: "status", actionMode: "status" },
  { agentId: "ops", match: /\bops\b|clickup|task\s+card|stalled|follow[- ]?up|attention/i, readOnly: /\b(show|what|status|urgent|stalled)\b/i, readOnlyMode: "status", actionMode: "followup" },
];

function statusOf(agent: MetaAgent | undefined): AgentStatus | "n/a" {
  return agent ? agent.status : "n/a";
}

/**
 * Route a cockpit command to an agent + mode + safety posture. Pure + deterministic. `reg` defaults
 * to the canonical registry. Order: org/capability questions → named-agent match (read-only vs
 * action) → bare mutation verb → generic read-only → unknown (honest fallback).
 */
export function routeCockpitCommand(request: string, reg: MetaAgentRegistry = resolveMetaAgentRegistry()): RoutingDecision {
  const text = (request ?? "").trim();
  const lower = text.toLowerCase();
  const base = {
    request: text,
    selectedAgentName: null as string | null,
    capabilityStatus: "n/a" as AgentStatus | "n/a",
  };

  if (text.length === 0) {
    return { ...base, intentClass: "unknown", selectedAgentId: null, selectedMode: "none", reason: "empty request", confidence: "low", directAnswerPossible: false, needsProposal: false, needsApproval: false, requiresLocalRunner: false, fallback: "Ask a question or name an agent (e.g. \"show me my agents\")." };
  }

  // 1) Organisation / capability questions → the registry/org panel (read-only, always answerable).
  if (ORG_RE.test(lower) || CAPABILITIES_RE.test(lower)) {
    const orch = reg.byId["orchestrator"];
    return { ...base, intentClass: "organisation", selectedAgentId: "orchestrator", selectedAgentName: orch?.displayName ?? "Orchestrator", selectedMode: "organisation", reason: "asks about the agent organisation / what HartOS can do", confidence: "high", directAnswerPossible: true, needsProposal: false, needsApproval: false, requiresLocalRunner: false, capabilityStatus: "live", fallback: "" };
  }

  // 2) Named-agent / domain match → read-only vs action, honesty from the registry.
  for (const m of MATCHERS) {
    if (!m.match.test(lower)) continue;
    const agent = reg.byId[m.agentId];
    const isReadOnly = m.readOnly.test(lower) && !MUTATION_RE.test(lower) && !(m.agentId === "factory" && CREATE_AGENT_RE.test(lower));
    const mode = isReadOnly ? m.readOnlyMode : m.actionMode;
    const status = statusOf(agent);
    if (isReadOnly) {
      // Read-only intelligence: answer directly from state/vault/memory/dossiers.
      return { ...base, intentClass: "meta_agent_invocation", selectedAgentId: m.agentId, selectedAgentName: agent?.displayName ?? m.agentId, selectedMode: mode, reason: `read-only ${m.agentId} intelligence`, confidence: "high", directAnswerPossible: status !== "unavailable", needsProposal: false, needsApproval: false, requiresLocalRunner: false, capabilityStatus: status, fallback: status === "unavailable" ? `${agent?.displayName ?? m.agentId} is currently ${status}: ${agent?.statusReason ?? ""}` : "" };
    }
    // Action: gated proposal/job; honest about a local runner.
    const needsRunner = !!agent?.requiresLocalRunner;
    return { ...base, intentClass: "meta_agent_invocation", selectedAgentId: m.agentId, selectedAgentName: agent?.displayName ?? m.agentId, selectedMode: mode, reason: `${m.agentId} action (${mode})`, confidence: "high", directAnswerPossible: false, needsProposal: true, needsApproval: !!agent?.requiresApproval, requiresLocalRunner: needsRunner, capabilityStatus: status, fallback: needsRunner ? `${agent?.displayName ?? m.agentId} ${mode} needs a local runner — create a gated job or run the CLI.` : "Becomes a gated proposal for Hart's approval." };
  }

  // 3) Bare mutation verb with no agent (approve/reject/sync/...) → mutation rehearsal (gated).
  if (MUTATION_RE.test(lower)) {
    return { ...base, intentClass: "mutation_action", selectedAgentId: "execution-engine", selectedAgentName: "Execution Engine / Mutation Spine", selectedMode: "rehearse", reason: "an action/mutation request — routes to the gated mutation spine (rehearsal)", confidence: "medium", directAnswerPossible: false, needsProposal: true, needsApproval: true, requiresLocalRunner: true, capabilityStatus: statusOf(reg.byId["execution-engine"]), fallback: "Becomes a gated, audited proposal; execution requires approval + a runner. Nothing executes from the cockpit." };
  }

  // 4) Generic read-only question (what/show/how/which/is/summari[sz]e) → orchestrator answers from state/vault.
  if (/^(what|who|show|how|why|which|is|are|do|does|summari[sz]e|tell\s+me|list)\b/i.test(lower) || lower.endsWith("?")) {
    return { ...base, intentClass: "read_only_intelligence", selectedAgentId: "orchestrator", selectedAgentName: "HartOS Command / Orchestrator", selectedMode: "answer", reason: "general read-only question — answered from live state + vault/Rinnegan + memory", confidence: "medium", directAnswerPossible: true, needsProposal: false, needsApproval: false, requiresLocalRunner: false, capabilityStatus: "live", fallback: "" };
  }

  // 5) Unknown / unsupported → fail closed, honest. No fabricated capability, no fake execution.
  return { ...base, intentClass: "unknown", selectedAgentId: null, selectedMode: "none", reason: "no agent or read-only intent matched", confidence: "low", directAnswerPossible: false, needsProposal: false, needsApproval: false, requiresLocalRunner: false, fallback: "I'm not sure which agent handles that. Try naming one (Wolverine, Beezulbub, Research, Prophet, Factory) or ask \"what can HartOS do right now?\"" };
}
