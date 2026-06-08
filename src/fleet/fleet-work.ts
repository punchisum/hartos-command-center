/**
 * src/fleet/fleet-work.ts
 *
 * F-phase depth — the shared TASK layer that turns the three deterministic agents
 * (Research, Rinnegan, Fleet OS) into orchestratable material, so F4 (multi-agent
 * orchestration) and F5 (forecast/repair) have something real to work on.
 *
 * Agents PRODUCE typed tasks (research sub-questions; perception repairs), Fleet OS
 * ROUTES each by capability, and the aggregate is a single work list. Crucially, a
 * task no registered agent can handle is flagged `unrouted` — a capability GAP that
 * is the honest, explicit signal to grow the fleet (the real trigger for F4/new
 * agents), not silently dropped. Pure, deterministic, propose-only — nothing here
 * executes; it structures proposed work for Hart.
 */

import type { ResearchPlan } from "../research/research-planner.js";
import type { PerceptionReport } from "../rinnegan/perception.js";
import { FLEET_REGISTRY, type AgentRegistration } from "./fleet-os.js";

export type TaskType = "research_question" | "repair" | "refresh" | "followup" | "review";
export type TaskStatus = "open" | "in_progress" | "done" | "blocked";
export type TaskPriority = "low" | "medium" | "high";

export interface AgentTask {
  id: string;
  type: TaskType;
  title: string;
  /** Producing agent: "research" | "rinnegan" | ... */
  origin: string;
  /** Capability needed to handle it — what routing matches against. */
  targetCapability: string;
  status: TaskStatus;
  priority: TaskPriority;
  detail: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "x";
}
/** Content-stable task id, so the same proposed work doesn't duplicate across passes. */
function taskId(origin: string, type: string, key: string): string {
  return `task-${slug(origin)}-${slug(type)}-${slug(key)}`.slice(0, 120);
}

/** Research plan → one research_question task per sub-question. */
export function planToTasks(plan: ResearchPlan): AgentTask[] {
  return plan.subQuestions.map((q) => ({
    id: taskId("research", "research_question", q),
    type: "research_question" as TaskType,
    title: q,
    origin: "research",
    targetCapability: "research",
    status: "open" as TaskStatus,
    priority: plan.risk,
    detail: `From a ${plan.shape} research plan (${plan.verdict}). Gather: ${plan.requiredInputs.join("; ")}.`,
  }));
}

/** Perception observations → repair / refresh / followup tasks (Wolverine fuel). */
export function perceptionToTasks(report: PerceptionReport): AgentTask[] {
  return report.observations.map((o) => {
    const type: TaskType = o.kind === "staleness" ? "refresh" : o.kind === "backlog" ? "followup" : "repair";
    const targetCapability = type === "refresh" ? "refresh" : type === "followup" ? "ops" : "repair";
    const priority: TaskPriority = o.severity === "critical" ? "high" : o.severity === "warn" ? "medium" : "low";
    return {
      id: taskId("rinnegan", type, `${o.subject}-${o.kind}`),
      type,
      title: o.recommendation,
      origin: "rinnegan",
      targetCapability,
      status: "open" as TaskStatus,
      priority,
      detail: o.detail,
    };
  });
}

export interface RoutedTask {
  task: AgentTask;
  /** Ids of registered agents whose capabilities can handle this task. */
  handlers: string[];
  routed: boolean;
}

/** Match a task to capable agents (by capability). Pure. */
export function routeTask(task: AgentTask, registry: AgentRegistration[] = FLEET_REGISTRY): RoutedTask {
  const handlers = registry.filter((r) => (r.capabilities ?? []).includes(task.targetCapability)).map((r) => r.id);
  return { task, handlers, routed: handlers.length > 0 };
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };

export interface FleetWork {
  tasks: RoutedTask[];
  open: number;
  /** Tasks no registered agent can handle — capability gaps (the signal to grow the fleet). */
  unrouted: number;
  /** Capabilities for which there's demand but no agent — the concrete "build next" list. */
  gaps: string[];
  byCapability: Record<string, number>;
}

/**
 * Aggregate proposed work from the agents and route it. The output is the
 * F4-ready substrate: a single, priority-ranked, capability-routed work list, with
 * the capability gaps made explicit.
 */
export function collectFleetTasks(input: { plan?: ResearchPlan; perception?: PerceptionReport; registry?: AgentRegistration[] }): FleetWork {
  const registry = input.registry ?? FLEET_REGISTRY;
  const raw: AgentTask[] = [
    ...(input.plan ? planToTasks(input.plan) : []),
    ...(input.perception ? perceptionToTasks(input.perception) : []),
  ];
  const tasks = raw.map((t) => routeTask(t, registry));
  tasks.sort((a, b) => PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority]);

  const byCapability: Record<string, number> = {};
  const gapSet = new Set<string>();
  for (const t of tasks) {
    byCapability[t.task.targetCapability] = (byCapability[t.task.targetCapability] ?? 0) + 1;
    if (!t.routed) gapSet.add(t.task.targetCapability);
  }
  return {
    tasks,
    open: tasks.length,
    unrouted: tasks.filter((t) => !t.routed).length,
    gaps: [...gapSet].sort(),
    byCapability,
  };
}

export interface FleetAgentLoad {
  id: string;
  name: string;
  assigned: number;
  capacity: number;
  overloaded: boolean;
}

export interface FleetLoad {
  agents: FleetAgentLoad[];
  /** Agent ids whose routed work exceeds their capacity. */
  overloaded: string[];
  totalOpen: number;
  /** Capability gaps carried through from the work (no agent can take them). */
  gaps: string[];
}

/**
 * Assess per-agent load from the routed work: a task counts toward every agent that
 * COULD handle it (potential load), and an agent is over-subscribed when that
 * exceeds its capacity. This is the load model F4's orchestrator routes against, and
 * — with `gaps` — the two honest "the fleet can't keep up" signals (overloaded +
 * unhandled), i.e. when to grow the fleet. Pure.
 */
export function assessFleetLoad(work: FleetWork, registry: AgentRegistration[] = FLEET_REGISTRY): FleetLoad {
  const counts: Record<string, number> = {};
  for (const rt of work.tasks) {
    for (const h of rt.handlers) counts[h] = (counts[h] ?? 0) + 1;
  }
  const agents: FleetAgentLoad[] = registry.map((r) => {
    const assigned = counts[r.id] ?? 0;
    return { id: r.id, name: r.name, assigned, capacity: r.capacity, overloaded: r.capacity > 0 && assigned > r.capacity };
  });
  return {
    agents,
    overloaded: agents.filter((a) => a.overloaded).map((a) => a.id),
    totalOpen: work.open,
    gaps: work.gaps,
  };
}
