/**
 * src/cockpit/proposals/cockpit-proposal-spine.ts
 *
 * Phase D — SHARED, PURE proposal-spine helpers. Zero I/O, zero secrets, no
 * Node-only or browser-only deps, so BOTH sides import it safely:
 *   • the Node write store (supabase-proposal-store.ts), and
 *   • the hosted Worker reader (cloudflare-live-read-models.ts).
 *
 * It defines the read RPC name, the row shape that RPC returns, and the pure
 * mapping from a row to a ProposalQueueItem the cockpit views already consume.
 */

import type {
  ActionProposal,
  ProposalActionType,
  ProposalAuditEvent,
  ProposalDomain,
  ProposalQueueItem,
  ProposalQueueStatus,
  ProposalRisk,
} from "./proposal-types.js";

/** The single anon-callable, read-only RPC that exposes cockpit proposals. */
export const COCKPIT_PROPOSALS_RPC = "get_cockpit_proposals";

/** The scalar columns the RPC returns (snake_case, matching the SQL). */
export interface CockpitProposalRow {
  id: string;
  domain: string;
  action_type: string;
  title: string;
  risk_level: string;
  status: string;
  source_intent: string | null;
  spec_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  /** The agent-job kind (payload→proposedPayload→jobKind), surfaced so Live Ops can label work. */
  job_kind: string | null;
  /** What the agent_job was asked to do (payload→proposedPayload→jobArg) — the task's intent. */
  job_arg?: string | null;
  /** The append-only lifecycle trail (payload→auditEvents) — per-task progress for Live Ops. */
  audit_events?: ProposalAuditEvent[] | null;
}

/**
 * Coerce the RPC's `audit_events` jsonb into well-formed {at,event,detail?} entries (skips junk).
 * The RPC ships event NAMES + short details only — never a payload/beforeState/afterState/secret —
 * so this is safe to surface in the read-only cockpit. Returns [] for any non-array / absent value.
 */
function coerceAuditEvents(raw: unknown): ProposalAuditEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposalAuditEvent[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.at !== "string" || typeof o.event !== "string") continue;
    out.push({ at: o.at, event: o.event, ...(typeof o.detail === "string" ? { detail: o.detail } : {}) });
  }
  return out;
}

/** Coerce the RPC's `unknown` JSON body into well-formed rows (skips junk). */
export function coerceCockpitProposalRows(body: unknown): CockpitProposalRow[] {
  if (!Array.isArray(body)) return [];
  const rows: CockpitProposalRow[] = [];
  for (const r of body) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id.length === 0) continue;
    rows.push({
      id: o.id,
      domain: typeof o.domain === "string" ? o.domain : "system",
      action_type: typeof o.action_type === "string" ? o.action_type : "review_plan",
      title: typeof o.title === "string" ? o.title : "(untitled)",
      risk_level: typeof o.risk_level === "string" ? o.risk_level : "low",
      status: typeof o.status === "string" ? o.status : "draft",
      source_intent: typeof o.source_intent === "string" ? o.source_intent : null,
      spec_id: typeof o.spec_id === "string" ? o.spec_id : null,
      created_at: typeof o.created_at === "string" ? o.created_at : "",
      updated_at: typeof o.updated_at === "string" ? o.updated_at : "",
      expires_at: typeof o.expires_at === "string" ? o.expires_at : null,
      job_kind: typeof o.job_kind === "string" && o.job_kind.length > 0 ? o.job_kind : null,
      job_arg: typeof o.job_arg === "string" && o.job_arg.length > 0 ? o.job_arg : null,
      audit_events: coerceAuditEvents(o.audit_events),
    });
  }
  return rows;
}

/**
 * Map one RPC row to the ProposalQueueItem the cockpit views consume. The hosted
 * surface only reads id/domain/riskLevel/title/status (+ counts), so the fields
 * the RPC does not carry are filled with honest, non-fabricated defaults
 * (empty/null) rather than invented content.
 */
export function mapRowToProposalQueueItem(row: CockpitProposalRow): ProposalQueueItem {
  return {
    id: row.id,
    domain: row.domain as ProposalDomain,
    actionType: row.action_type as ProposalActionType,
    title: row.title,
    description: "",
    sourceIntent: row.source_intent ?? "",
    // Carry the job kind + arg so the hosted Live Ops view can label agent_job work honestly and
    // show what the task was actually asked to do.
    proposedPayload: {
      ...(row.job_kind ? { jobKind: row.job_kind } : {}),
      ...(row.job_arg ? { jobArg: row.job_arg } : {}),
    },
    expectedEffect: "",
    riskLevel: row.risk_level as ProposalRisk,
    requiredApproval: "Hart",
    status: row.status as ProposalQueueStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    safetyNotes: [],
    blockedReason: "",
    dryRunResult: null,
    executable: false,
    updatedAt: row.updated_at,
    // The append-only lifecycle trail, now surfaced by the RPC (was hardcoded [] before the
    // 20260615150000 migration) — this is the per-task progress Live Ops expands to show.
    auditEvents: row.audit_events ?? [],
    specId: row.spec_id,
  };
}

// ─── Phase E — Ask HartOS → spine WRITE mapping (shared, pure) ─────────────────

/** The columns the Edge Function upserts. The read row + the jsonb payload. */
export interface CockpitProposalWriteRow {
  id: string;
  domain: string;
  action_type: string;
  title: string;
  risk_level: string;
  status: string;
  source_intent: string | null;
  spec_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  payload: Record<string, unknown>;
}

/**
 * Statuses the hosted Ask path may persist. The hosted surface is propose-only:
 * it can create drafts awaiting Hart, never anything executable. Executor-only
 * states (executing / executed / runtime_provisioned / approved_for_execution …)
 * can NEVER be written from here — anything else collapses to "draft".
 */
export const ASK_PERSIST_STATUSES = ["draft", "pending_approval"] as const;
export type AskPersistStatus = (typeof ASK_PERSIST_STATUSES)[number];

export function coerceAskPersistStatus(status: string): AskPersistStatus {
  return (ASK_PERSIST_STATUSES as readonly string[]).includes(status) ? (status as AskPersistStatus) : "draft";
}

function slug(s: string): string {
  // Underscores are kept (so an action_type stays legible in the id); every other
  // non-alphanumeric run collapses to a single dash.
  return s.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 60) || "untitled";
}

/**
 * A content-STABLE proposal id, derived from (domain, actionType, title). The
 * in-memory drafts use a timestamped id (`prop-<title>-<now>`), which would spam
 * the queue with a fresh row on every identical Ask. Persisting under a stable
 * id means re-asking the same outcome UPSERTS the same queue row instead.
 */
export function stableProposalId(domain: string, actionType: string, title: string): string {
  return `prop-${slug(domain)}-${slug(actionType)}-${slug(title)}`.slice(0, 120);
}

type PersistableProposal = Pick<
  ActionProposal,
  "domain" | "actionType" | "title" | "riskLevel" | "status" | "sourceIntent" | "createdAt" | "expiresAt"
> & { proposedPayload?: Record<string, unknown> };

/**
 * Map a generated (non-executable) proposal draft to a spine write row. Pure: the
 * caller supplies `now`. The status is clamped to the propose-only allowlist and
 * the payload is forced non-executable, so nothing executable can ever be
 * persisted from the hosted Ask path. The id is content-stable (idempotent Asks).
 */
export function proposalToSpineRow(p: PersistableProposal, opts: { now: string; sourceIntent?: string }): CockpitProposalWriteRow {
  const status = coerceAskPersistStatus(p.status);
  const id = stableProposalId(p.domain, p.actionType, p.title);
  const sourceIntent = opts.sourceIntent ?? p.sourceIntent ?? "";
  return {
    id,
    domain: p.domain,
    action_type: p.actionType,
    title: p.title,
    risk_level: p.riskLevel,
    status,
    source_intent: sourceIntent || null,
    spec_id: null,
    created_at: p.createdAt || opts.now,
    updated_at: opts.now,
    expires_at: p.expiresAt ?? null,
    payload: {
      id,
      origin: "hosted_ask",
      domain: p.domain,
      actionType: p.actionType,
      title: p.title,
      riskLevel: p.riskLevel,
      status,
      sourceIntent,
      proposedPayload: p.proposedPayload ?? {},
      executable: false,
    },
  };
}
