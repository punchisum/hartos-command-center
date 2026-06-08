/**
 * src/fleet/orchestrator.ts
 *
 * Phase F4 — the deterministic, PROPOSE-ONLY fleet orchestrator. It takes the routed
 * work list (from fleet-work) and the agent registry and produces an actual
 * ASSIGNMENT plan: which specific agent should do which task, in what dependency
 * order, respecting each agent's capacity — and, crucially, an honest list of what it
 * could NOT place and why.
 *
 * This is genuinely more than assessFleetLoad: that counts *potential* load (a task
 * weighs on every agent that COULD take it); this COMMITS each task to ONE agent
 * (the least-loaded capable agent still under capacity), so it's the real scheduling
 * decision. It also sequences by dependency — refresh/repair the data BEFORE the
 * followup/research/review that reads it — and never pretends it placed work it
 * couldn't. The two honest "the fleet can't keep up" signals are surfaced as
 * verdicts: `needs_agent` (a capability no agent has — build one) and
 * `blocked_capacity` (capable agents are full — scale them).
 *
 * Pure, fs/network-free, deterministic: same work → same plan. Nothing here executes;
 * it proposes a schedule for Hart to approve.
 */

import type { AgentTask, FleetWork, TaskType, TaskPriority } from "./fleet-work.js";
import { FLEET_REGISTRY, type AgentRegistration } from "./fleet-os.js";

export type OrchestrationVerdict = "idle" | "ready" | "blocked_capacity" | "needs_agent";

/** Why a task could not be placed. */
export type DeferralReason = "capability_gap" | "capacity";

export interface Assignment {
  task: AgentTask;
  agentId: string;
  agentName: string;
  /** Execution wave (1-based): every wave-N task should finish before wave N+1 starts. */
  order: number;
}

export interface Deferral {
  task: AgentTask;
  reason: DeferralReason;
  /** Honest, human-readable explanation of why it couldn't be placed. */
  detail: string;
}

export interface AgentAssignmentLoad {
  id: string;
  name: string;
  assigned: number;
  capacity: number;
  taskIds: string[];
}

export interface FleetPlan {
  verdict: OrchestrationVerdict;
  /** The committed schedule — one agent per task, in dependency-wave order. */
  assignments: Assignment[];
  /** Work that could not be placed, with an honest reason (never silently dropped). */
  deferred: Deferral[];
  /** Per-agent committed load (only agents that received work, in registry order). */
  perAgent: AgentAssignmentLoad[];
  /** Plain-language demand-vs-capacity notes for the human approving the plan. */
  reconciliation: string[];
}

/**
 * Dependency tiers: data-fixing work (refresh stale numbers, repair a broken
 * read-model) must run BEFORE the work that reads that data (followups acting on it,
 * research that consumes it, reviews of it). Lower tier = earlier wave.
 */
const DEP_TIER: Record<TaskType, number> = {
  refresh: 0,
  repair: 0,
  followup: 1,
  research_question: 1,
  review: 1,
};

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };

/**
 * Orchestrate the routed work into an approvable schedule. Greedy + deterministic:
 * tasks are ordered by dependency tier, then priority, then id (stable tiebreaker);
 * each is committed to the least-loaded capable agent that is still under capacity;
 * anything unplaceable is deferred with an honest reason.
 */
export function orchestrateFleet(work: FleetWork, opts: { registry?: AgentRegistration[] } = {}): FleetPlan {
  const registry = opts.registry ?? FLEET_REGISTRY;
  const capacityOf: Record<string, number> = {};
  const nameOf: Record<string, string> = {};
  for (const r of registry) {
    capacityOf[r.id] = r.capacity;
    nameOf[r.id] = r.name;
  }

  // Deterministic execution order: dependency tier first, then priority (high → low),
  // then task id as a stable tiebreaker so the plan never depends on input order.
  const ordered = [...work.tasks].sort((a, b) => {
    const ta = DEP_TIER[a.task.type] ?? 1;
    const tb = DEP_TIER[b.task.type] ?? 1;
    if (ta !== tb) return ta - tb;
    const pa = PRIORITY_RANK[a.task.priority];
    const pb = PRIORITY_RANK[b.task.priority];
    if (pa !== pb) return pb - pa;
    return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
  });

  const load: Record<string, number> = {};
  const perAgentTasks: Record<string, string[]> = {};
  const assignments: Assignment[] = [];
  const deferred: Deferral[] = [];

  for (const rt of ordered) {
    const task = rt.task;
    const wave = (DEP_TIER[task.type] ?? 1) + 1;

    if (rt.handlers.length === 0) {
      deferred.push({
        task,
        reason: "capability_gap",
        detail: `No agent has the "${task.targetCapability}" capability — build one before this can run.`,
      });
      continue;
    }

    // Least-loaded capable agent still under capacity. handlers preserves registry
    // order, so ties break deterministically toward the earlier-registered agent.
    const candidates = rt.handlers.filter((id) => (load[id] ?? 0) < (capacityOf[id] ?? 0));
    if (candidates.length === 0) {
      const names = rt.handlers.map((id) => nameOf[id] ?? id).join(", ");
      deferred.push({
        task,
        reason: "capacity",
        detail: `All capable agents (${names}) are at capacity — defer or raise their capacity.`,
      });
      continue;
    }
    let chosen = candidates[0]!;
    for (const id of candidates) {
      if ((load[id] ?? 0) < (load[chosen] ?? 0)) chosen = id;
    }
    load[chosen] = (load[chosen] ?? 0) + 1;
    (perAgentTasks[chosen] ??= []).push(task.id);
    assignments.push({ task, agentId: chosen, agentName: nameOf[chosen] ?? chosen, order: wave });
  }

  const perAgent: AgentAssignmentLoad[] = registry
    .filter((r) => (perAgentTasks[r.id]?.length ?? 0) > 0)
    .map((r) => ({ id: r.id, name: r.name, assigned: load[r.id] ?? 0, capacity: r.capacity, taskIds: perAgentTasks[r.id] ?? [] }));

  // Verdict: a capability gap (must BUILD a new agent) outranks a pure capacity block
  // (must SCALE an existing one) — it's the more structural ask.
  const gapDefers = deferred.filter((d) => d.reason === "capability_gap");
  const capDefers = deferred.filter((d) => d.reason === "capacity");
  const verdict: OrchestrationVerdict =
    ordered.length === 0 ? "idle"
    : deferred.length === 0 ? "ready"
    : gapDefers.length > 0 ? "needs_agent"
    : "blocked_capacity";

  const reconciliation: string[] = [];
  if (verdict === "idle") {
    reconciliation.push("No open work to orchestrate.");
  }
  if (assignments.some((a) => a.order === 1) && assignments.some((a) => a.order === 2)) {
    reconciliation.push("Run wave 1 (refresh/repair) before wave 2 (followup/research/review) — wave 2 reads the data wave 1 fixes.");
  }
  if (gapDefers.length > 0) {
    const caps = [...new Set(gapDefers.map((d) => d.task.targetCapability))].sort();
    reconciliation.push(`${gapDefers.length} task(s) need a capability no agent has (${caps.join(", ")}) — build an agent for it.`);
  }
  if (capDefers.length > 0) {
    const agents = [...new Set(capDefers.flatMap((d) => d.task.targetCapability))].sort();
    reconciliation.push(`${capDefers.length} task(s) deferred for capacity (${agents.join(", ")}) — raise capacity or stagger the work.`);
  }
  if (verdict === "ready") {
    reconciliation.push(`All ${assignments.length} task(s) placed within capacity.`);
  }

  return { verdict, assignments, deferred, perAgent, reconciliation };
}

/** One-line, deterministic summary of a fleet plan (for embedding / the cockpit). */
export function summarizeFleetPlan(plan: FleetPlan): string {
  const parts = [`${plan.assignments.length} assigned`];
  if (plan.deferred.length) parts.push(`${plan.deferred.length} deferred`);
  return `Orchestration ${plan.verdict.toUpperCase()} — ${parts.join(", ")}.`;
}
