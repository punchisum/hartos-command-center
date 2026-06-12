/**
 * src/cockpit/tasks-view.ts — the LIVE OPERATIONS view (pure, Worker-safe).
 *
 * Projects the proposal spine's agent_job rows into "tasks in flight" so the v5 cockpit's Live
 * Operations page can show what HartOS is actually DOING — Wolverine sweeping, an agent building,
 * research running — with an honest lifecycle stage. In the Neural Deck metaphor a task is a signal
 * propagating through the organism: queued (awaiting authorization) → running (approved, the daemon's
 * hands are on it) → done / failed. No fabrication: stage is read straight off the row's status +
 * its audit trail.
 */

export type TaskStage = "queued" | "running" | "done" | "failed" | "dismissed";

export interface TaskRow {
  id: string;
  /** The originating agent (display name) + its Neural-Deck color token. */
  agent: string;
  color: string;
  /** The job kind (research.brief, claude.execute, beezulbub.hunt, …) + a friendly verb. */
  kind: string;
  verb: string;
  title: string;
  stage: TaskStage;
  /** Plain-English lifecycle label — never a raw spine status (no "simulated_approved"). */
  stageLabel: string;
  /** "2m" / "1h" — age since last update. */
  ageLabel: string;
  updatedAt: string | null;
}

export interface TasksView {
  available: boolean;
  generatedAt: string;
  counts: { queued: number; running: number; done: number; failed: number; total: number };
  tasks: TaskRow[];
  note?: string;
}

/**
 * The minimal proposal-row shape this view needs. TWO shapes exist in the wild and BOTH must work:
 * local rows nest under `payload` (the spine's jsonb), while hosted rows (mapRowToProposalQueueItem)
 * carry `actionType`/`proposedPayload` at the TOP level — the old payload-only read made the hosted
 * Live Ops page permanently empty.
 */
export interface TaskSourceRow {
  id: string;
  title?: string;
  status?: string;
  domain?: string;
  updatedAt?: string | null;
  actionType?: unknown;
  proposedPayload?: { jobKind?: unknown; jobArg?: unknown };
  payload?: {
    actionType?: unknown;
    proposedPayload?: { jobKind?: unknown; jobArg?: unknown };
  } & Record<string, unknown>;
}

/** jobKind → [originating agent, Neural-Deck color, friendly verb]. */
const KIND_META: Record<string, [string, string, string]> = {
  "research.brief": ["Beezulbub", "#22E8FF", "researching"],
  "beezulbub.hunt": ["Beezulbub", "#22E8FF", "hunting capability"],
  "claude.execute": ["Factory", "#FF2D9E", "building"],
  "wolverine.audit": ["Wolverine", "#34F5A8", "sweeping"],
  "memory.capture": ["Executive Memory", "#A974FF", "capturing"],
  "rinnegan.sync": ["Rinnegan", "#22E8FF", "syncing"],
  report: ["Command", "#FFC24B", "reporting"],
};

/** Stage + the plain-English label Hart actually reads — raw spine names never reach the UI. */
function stageOf(status: string): { stage: TaskStage; label: string } {
  switch (status) {
    case "draft":
    case "pending_approval":
      return { stage: "queued", label: "awaiting your approval" };
    case "simulated_approved":
    case "approved_for_execution":
      return { stage: "queued", label: "approved — queued" };
    case "executing":
      return { stage: "running", label: "running" };
    case "executed":
      return { stage: "done", label: "done" };
    case "failed":
    case "execution_failed":
      return { stage: "failed", label: "failed" };
    case "rejected":
      return { stage: "dismissed", label: "rejected" };
    case "expired":
      return { stage: "dismissed", label: "expired" };
    default:
      return { stage: "queued", label: "queued" };
  }
}

/** Human age: "now" / "3m" / "2h" / "5d". */
export function ageLabel(updatedAt: string | null | undefined, nowIso: string): string {
  if (!updatedAt) return "—";
  const ms = Date.parse(nowIso) - Date.parse(updatedAt);
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Build the Live Operations view from the proposal queue. Only agent_job rows are tasks; everything
 * else (typed mutations, plans) is out of scope here. Newest first; dismissed rows sink to the end.
 */
export function buildTasksView(rows: TaskSourceRow[] | undefined, nowIso: string): TasksView {
  if (!rows) {
    return {
      available: false,
      generatedAt: nowIso,
      counts: { queued: 0, running: 0, done: 0, failed: 0, total: 0 },
      tasks: [],
      note: "No proposal spine resolved — Live Operations is unavailable (configure the read-model env).",
    };
  }
  const tasks: TaskRow[] = [];
  for (const r of rows) {
    // Accept BOTH row shapes: nested payload (local spine rows) and top-level (hosted RPC rows).
    const actionType = r.payload?.actionType ?? r.actionType;
    if (actionType !== "agent_job") continue;
    const rawKind = r.payload?.proposedPayload?.jobKind ?? r.proposedPayload?.jobKind;
    const kind = typeof rawKind === "string" && rawKind ? rawKind : "report";
    const [agent, color, verb] = KIND_META[kind] ?? ["Command", "#9C8CBC", "running"];
    const st = stageOf(typeof r.status === "string" ? r.status : "");
    tasks.push({
      id: r.id,
      agent,
      color,
      kind,
      verb,
      title: typeof r.title === "string" && r.title ? r.title : kind,
      stage: st.stage,
      stageLabel: st.label,
      ageLabel: ageLabel(r.updatedAt ?? null, nowIso),
      updatedAt: r.updatedAt ?? null,
    });
  }
  const rank: Record<TaskStage, number> = { running: 0, queued: 1, failed: 2, done: 3, dismissed: 4 };
  tasks.sort((a, b) => rank[a.stage] - rank[b.stage] || Date.parse(b.updatedAt ?? "0") - Date.parse(a.updatedAt ?? "0"));
  const counts = {
    queued: tasks.filter((t) => t.stage === "queued").length,
    running: tasks.filter((t) => t.stage === "running").length,
    done: tasks.filter((t) => t.stage === "done").length,
    failed: tasks.filter((t) => t.stage === "failed").length,
    total: tasks.length,
  };
  return { available: true, generatedAt: nowIso, counts, tasks };
}
