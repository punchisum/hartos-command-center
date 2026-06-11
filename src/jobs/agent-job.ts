/**
 * src/jobs/agent-job.ts — the GATED AGENT-JOB contract (the autonomy spine's connective tissue).
 *
 * Closes the cockpit→runner loop: when the cockpit routes a command to an agent that needs a local
 * runner (Beezulbub hunt, Wolverine audit, Research brief, memory capture, vault sync), the Worker
 * no longer dead-ends at "requires runner" — it CREATES A GATED JOB PROPOSAL in the existing
 * Supabase spine. Hart approves it in the cockpit (Approve → simulated_approved, audited), and the
 * local runner (scripts/hartos-runner.ts) picks it up, executes the mapped agent action under that
 * action's OWN env gates, and advances the spine → executed (+ audit row).
 *
 * Approval floor intact end-to-end: cockpit creates pending_approval (never executes) → Hart
 * approves → runner executes gated → audit. PURE + Worker-safe: no fs/clock/net (now injected).
 */

import type { ActionProposal, ProposalActionType } from "../cockpit/proposals/proposal-types.js";
import type { RoutingDecision } from "../cockpit/command-router.js";

/** The runner-executable job kinds (each maps to an existing, gated local action). */
export const AGENT_JOB_KINDS = [
  "beezulbub.hunt",
  "wolverine.audit",
  "research.brief",
  "memory.capture",
  "rinnegan.sync",
  "report",
] as const;

export type AgentJobKind = (typeof AGENT_JOB_KINDS)[number];

/**
 * Runtime guard for a value read off the spine row before it is dispatched. The runner is the
 * gated HANDS of the autonomy spine — it must verify the instructions it trusts rather than cast
 * blindly. An unknown kind is rejected (audited `failed`), never silently swallowed by a default.
 */
export function isAgentJobKind(v: unknown): v is AgentJobKind {
  return typeof v === "string" && (AGENT_JOB_KINDS as readonly string[]).includes(v);
}

/**
 * Clamp + sanitize a job argument read off the spine before it reaches a live action (e.g. a
 * GitHub search query). Strips control characters, collapses whitespace, and bounds the length —
 * defense in depth for the gated hands; the per-action gates still decide whether anything runs.
 */
export function sanitizeJobArg(v: unknown): string {
  if (typeof v !== "string") return "";
  // Replace control characters (code point < 0x20, or 0x7f) with a space — no control-char
  // literals in source. Then collapse whitespace, trim, and bound the length.
  let cleaned = "";
  for (const ch of v) {
    const code = ch.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 200);
}

export interface AgentJobSpec {
  kind: AgentJobKind;
  /** The free-text argument (capability target / research question / empty). */
  arg: string;
  /** The exact local command a human could run instead (honest escape hatch). */
  localCommand: string;
  /** The env gates the runner action itself still enforces (informational, never bypassed). */
  gates: string[];
}

/** Map a routing decision to a runnable job spec; null when the route isn't runner-executable. */
export function jobSpecFromRoute(route: RoutingDecision): AgentJobSpec | null {
  const arg = route.request.replace(/^[^,]*,\s*/, "").trim(); // strip a leading "Agent," prefix
  // A report is mode-keyed (any agent may originate it), so handle it before the agent switch.
  if (route.selectedMode === "report") {
    return {
      kind: "report",
      arg,
      localCommand: `npm run report:run -- "${arg || "HartOS state report"}"`,
      gates: ["ALLOW_OBSIDIAN_WRITE (to file the report to the vault)"],
    };
  }
  switch (route.selectedAgentId) {
    case "beezulbub":
      if (route.selectedMode !== "hunt") return null;
      return {
        kind: "beezulbub.hunt",
        arg: extractTarget(route.request),
        localCommand: `npm run beezulbub:hunt -- ${extractTarget(route.request)}`,
        gates: ["BEEZULBUB_ALLOW_NETWORK", "ALLOW_OBSIDIAN_WRITE (to file the dossier)"],
      };
    case "wolverine":
      if (route.selectedMode !== "audit") return null;
      return { kind: "wolverine.audit", arg: "", localCommand: "npm run wolverine:audit", gates: ["(read-only — none)"] };
    case "research":
      if (route.selectedMode !== "brief") return null;
      return {
        kind: "research.brief",
        arg,
        localCommand: `npm run research:run -- "${arg}"`,
        gates: ["HARTOS_RESEARCH_GATHER", "HARTOS_LLM_PROVIDER=openai", "HARTOS_RESEARCH_MODE=web (optional)"],
      };
    case "executive-memory":
      return { kind: "memory.capture", arg: "", localCommand: "npm run cockpit:memory-capture", gates: ["HARTOS_MEMORY_CAPTURE"] };
    case "rinnegan":
      return { kind: "rinnegan.sync", arg: "", localCommand: "npm run rinnegan:sync-pack", gates: ["HARTOS_SUPABASE_DB_URL"] };
    default:
      return null;
  }
}

/** Pull a kebab/word capability target out of a hunt request (best-effort, honest fallback). */
function extractTarget(request: string): string {
  const m = request.toLowerCase().match(/hunt\s+([a-z0-9_\- ]{2,40})/);
  const raw = (m?.[1] ?? "").trim().replace(/\s+/g, "_");
  return raw || "general";
}

/**
 * Build the GATED job proposal the Worker persists to the spine. Status pending_approval — it
 * appears in the cockpit Approvals immediately; NOTHING runs until Hart approves AND the runner
 * picks it up AND that action's own env gates are armed. Triple-gated by construction.
 */
export function buildAgentJobProposal(spec: AgentJobSpec, route: RoutingDecision, now: string): ActionProposal {
  const id = `job-${spec.kind.replace(/\./g, "-")}-${now.replace(/[:.]/g, "-")}`;
  return {
    id,
    domain: "system",
    // "agent_job" is the canonical job semantics; the union cast is intentional + isolated here
    // (same pattern as factory-officiator's persist proposal).
    actionType: "agent_job" as unknown as ProposalActionType,
    title: `Run ${spec.kind}${spec.arg ? `: ${spec.arg}` : ""}`,
    description:
      `Gated agent job created from the cockpit (“${route.request}”). On approval, the local runner executes ` +
      `${spec.kind} under its own env gates (${spec.gates.join(", ")}). Equivalent local command: ${spec.localCommand}`,
    sourceIntent: `cockpit-ask: ${route.request}`,
    proposedPayload: { jobKind: spec.kind, jobArg: spec.arg, localCommand: spec.localCommand },
    expectedEffect: `${spec.kind} runs once on the local runner; results are filed (dossier/audit/snapshot) and surfaced in the cockpit.`,
    riskLevel: spec.kind === "research.brief" ? "medium" : "low",
    requiredApproval: "Hart",
    status: "pending_approval",
    createdAt: now,
    expiresAt: null,
    safetyNotes: [
      "Created by the cockpit router — the cockpit NEVER executes.",
      "Runs only after Hart approves AND the local runner picks it up AND the action's own gates are armed.",
      "Read/propose-shaped work (scout/audit/brief/capture/sync) — no provider mutation.",
    ],
    blockedReason: "Awaiting Hart's approval; the cockpit has no execution path.",
    dryRunResult: null,
    executable: false,
  };
}
