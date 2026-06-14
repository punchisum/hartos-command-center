/**
 * src/agents/agent-manifest.ts — the Agent Manifest (source-of-truth record) + derived status.
 *
 * Design: docs/superpowers/specs/2026-06-14-dynamic-agent-registration-cockpit.md.
 *
 * Constitutional requirement (Hart, 2026-06-14): the cockpit is a VISUALIZATION of the source of
 * truth, not a static dashboard. An AgentManifest is the durable, authored record written on Synapse
 * approval (the existing proposal approval gate); `lifecycle` is the authored part. The DISPLAYED
 * status is NOT stored — it is DERIVED at read time from manifest + liveness read-model + arming,
 * via `deriveAgentStatus`. Nothing is "live" unless its manifest is approved AND a health read-model
 * confirms it (liveness.state === "up"); scaffolded-but-unapproved => draft/pending, never faked live.
 *
 * PURE / Worker-safe: no node: imports, no network, no clock, never throws. It DESCRIBES + DERIVES;
 * it never executes. Registry store = public.agent_registry in the cockpit Supabase project
 * (xbuinrnpfjltimofwrdx): Node writes elevated, the Worker reads via a security-definer anon RPC.
 */

/** Authored lifecycle (set by the build/approval pipeline). `status` is derived, never authored. */
export type AgentLifecycle =
  | "draft"
  | "pending_approval"
  | "approved"
  | "provisioning"
  | "live"
  | "retired";

/** Computed-at-read-time displayed status. Health-confirmed: only liveness "up" yields "live". */
export type DerivedStatus =
  | "draft"
  | "pending"
  | "provisioning"
  | "disarmed"
  | "live"
  | "watch"
  | "offline";

const AGENT_LIFECYCLES: readonly AgentLifecycle[] = [
  "draft",
  "pending_approval",
  "approved",
  "provisioning",
  "live",
  "retired",
];

/**
 * The source-of-truth record per agent, written on Synapse approval, read by the cockpit.
 * `lifecycle` is authored; the displayed status is derived (see `deriveAgentStatus`).
 */
export interface AgentManifest {
  /** Stable slug. */
  agentId: string;
  displayName: string;
  /** One-line capability summary. */
  capabilitySummary: string;
  /** Org-hierarchy parent. null = root. */
  parentId: string | null;
  /** Autonomy tier, e.g. "T0".."T6". */
  tier: string;
  lifecycle: AgentLifecycle;
  /** Proposal / execution permissions. */
  permissions: { propose: boolean; execute: boolean };
  /** The env flag that arms its hands (e.g. "HARTOS_ALLOW_SELF_MOD"), or null if none. */
  armingFlag: string | null;
  /** The build_agent_plan proposal that created it, or null. */
  sourceProposalId: string | null;
  knownRisks: string[];
  createdAt: string;
  approvedAt: string | null;
  retiredAt: string | null;
}

/** Liveness read-model state for an agent (from Sentinel). null = no read-model at all. */
export interface AgentLiveness {
  state: "up" | "stale" | "down" | "unknown" | null;
}

export interface DeriveAgentStatusOptions {
  killSwitchOn?: boolean;
}

/** Type guard: is `v` a valid AgentLifecycle? */
export function isAgentLifecycle(v: unknown): v is AgentLifecycle {
  return typeof v === "string" && (AGENT_LIFECYCLES as readonly string[]).includes(v);
}

/**
 * Derive an agent's DISPLAYED status purely from truth — manifest lifecycle + liveness read-model +
 * arming. PURE, never throws. Implements the SPEC §3 rules exactly:
 *
 *   if lifecycle in {draft, pending_approval}          -> "draft" / "pending"
 *   else if lifecycle === provisioning                 -> "provisioning"
 *   else if killSwitchOn && permissions.execute        -> "disarmed"
 *   else if liveness.state === "up"                    -> "live"     (HEALTH-CONFIRMED, #4)
 *   else if liveness.state in {stale, unknown}         -> "watch"    (approved but unconfirmed)
 *   else                                                -> "offline"
 *
 * Fail-closed: absent/unconfirmed health never yields "live"; only liveness.state === "up" does.
 * A retired agent is never live — it falls through to "offline" (no liveness "up" expected).
 */
export function deriveAgentStatus(
  manifest: AgentManifest,
  liveness: AgentLiveness | null,
  opts: DeriveAgentStatusOptions = {}
): DerivedStatus {
  // Defensive safe-extraction: tolerate malformed/unknown input without throwing.
  const lifecycle: AgentLifecycle | null = isAgentLifecycle(manifest?.lifecycle)
    ? manifest.lifecycle
    : null;

  if (lifecycle === "draft") return "draft";
  if (lifecycle === "pending_approval") return "pending";
  if (lifecycle === "provisioning") return "provisioning";
  if (lifecycle === "retired") return "offline"; // retired is never live — short-circuit before liveness

  const canExecute = manifest?.permissions?.execute === true;
  if (opts.killSwitchOn === true && canExecute) return "disarmed";

  const livenessState = liveness?.state ?? null;
  if (livenessState === "up") return "live"; // health-confirmed (#4)
  if (livenessState === "stale" || livenessState === "unknown") return "watch";

  return "offline";
}
