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
  ProposalActionType,
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
    proposedPayload: {},
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
    auditEvents: [],
    specId: row.spec_id,
  };
}
