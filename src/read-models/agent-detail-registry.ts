/**
 * src/read-models/agent-detail-registry.ts
 *
 * Phase C — Gap C: a GENERIC, declarative per-agent detail contract.
 *
 * The fitness/ops detail read-models (agent-detail.ts) are bespoke and rich. This
 * module is the seam that lets a NEW agent surface a full /agent/<domain>/ui
 * dashboard by DECLARING a spec (its read RPCs + how each maps to a section) —
 * with NO new rendering or routing code. The route dispatches by domain, the
 * generic builder turns the spec's RPC bodies into renderable sections, and the
 * generic renderer (cloudflare-cockpit-page) draws any of them identically.
 *
 * Same strict boundary as the bespoke detail: a read-only SupabaseReadClient (anon
 * key, allowlisted read RPCs only — no mutation possible). A failed RPC degrades
 * that section to empty + a note; nothing is fabricated; no secret ever leaves.
 */

import type { ReadModelStatus } from "./read-model-types.js";
import { SupabaseReadError, type SupabaseReadClient } from "./supabase-read-client.js";

type Rec = Record<string, unknown>;
function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
/** Render one cell honestly: a missing value is an em-dash, never blank/fabricated. */
function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return JSON.stringify(v);
}
function rowsOf(body: unknown, rowsKey?: string): Rec[] {
  if (Array.isArray(body)) return body.filter(isRec);
  if (isRec(body)) {
    for (const key of [rowsKey, "rows", "items", "data"].filter(Boolean) as string[]) {
      const inner = body[key];
      if (Array.isArray(inner)) return inner.filter(isRec);
    }
    return [body];
  }
  return [];
}

/** One renderable section of a generic detail page. */
export interface DetailSection {
  title: string;
  kind: "table" | "kv";
  /** table: column headers (in order). kv: ["Field","Value"]. */
  headers: string[];
  /** table: one array of cells per row. kv: [["label","value"], ...]. */
  rows: string[][];
}

/** The generic, render-ready detail for any registered agent. */
export interface GenericAgentDetail {
  kind: "generic";
  type: string;
  label: string;
  status: ReadModelStatus;
  generatedAt: string;
  sections: DetailSection[];
  notes: string[];
}

/** Map one RPC body → one section. `field` reads a top-level key off each row. */
export interface DetailRpcSpec {
  rpc: string;
  section: string;
  render: "table" | "kv";
  columns: Array<{ header: string; field: string }>;
  /** Static args merged with the resolved base args (user/agent ids). */
  args?: Record<string, unknown>;
  /** Optional key to find the row array inside an object body. */
  rowsKey?: string;
}

/** A new agent declares one of these to get a full detail page — no UI code. */
export interface AgentDetailSpec {
  domain: string;
  label: string;
  /** Env var NAMES (never values) for the read-only Supabase endpoint. */
  urlEnv: string;
  keyEnv: string;
  /** Optional uuid arg env var NAMES, injected as p_user_id / p_agent_id. */
  userIdEnv?: string;
  agentIdEnv?: string;
  rpcs: DetailRpcSpec[];
}

/**
 * Registered generically-rendered agents. fitness/ops stay bespoke (rich) and are
 * intentionally NOT here. Empty until a new agent (e.g. Phase F1 Research) lands —
 * registering one is purely DATA (push a spec), never UI/route code. The generic
 * path is exercised by tests so the seam is proven, not hypothetical.
 */
export const AGENT_DETAIL_SPECS: AgentDetailSpec[] = [];

export function findAgentDetailSpec(domain: string, specs: AgentDetailSpec[] = AGENT_DETAIL_SPECS): AgentDetailSpec | undefined {
  return specs.find((s) => s.domain === domain);
}

/** Every RPC a spec may call — the exact anon allowlist for its read client. */
export function specAllowedRpcs(spec: AgentDetailSpec): string[] {
  return [...new Set(spec.rpcs.map((r) => r.rpc))];
}

async function callRpc(client: SupabaseReadClient, name: string, args: Rec): Promise<{ reached: boolean; body: unknown }> {
  try {
    return { reached: true, body: await client.readRpc(name, args) };
  } catch (err) {
    // A single failed RPC degrades its section; it never throws the whole page.
    if (err instanceof SupabaseReadError) return { reached: false, body: undefined };
    return { reached: false, body: undefined };
  }
}

/**
 * Build a render-ready GenericAgentDetail from a spec, using the agent's own
 * read-only RPCs. Pure w.r.t. time (caller supplies `now`); every RPC outcome is
 * honest — a failed/empty one degrades to an empty section + a note.
 */
export async function buildGenericAgentDetail(
  client: SupabaseReadClient,
  spec: AgentDetailSpec,
  baseArgs: Rec,
  opts: { now: string },
): Promise<GenericAgentDetail> {
  const sections: DetailSection[] = [];
  const notes: string[] = [];
  let reachedAny = false;
  let anyRows = false;

  for (const rpcSpec of spec.rpcs) {
    const outcome = await callRpc(client, rpcSpec.rpc, { ...baseArgs, ...(rpcSpec.args ?? {}) });
    if (!outcome.reached) {
      notes.push(`${rpcSpec.section} unavailable`);
      sections.push({ title: rpcSpec.section, kind: rpcSpec.render, headers: rpcSpec.columns.map((c) => c.header), rows: [] });
      continue;
    }
    reachedAny = true;
    const rows = rowsOf(outcome.body, rpcSpec.rowsKey);
    const headers = rpcSpec.columns.map((c) => c.header);
    let sectionRows: string[][];
    if (rpcSpec.render === "kv") {
      const first = rows[0] ?? {};
      sectionRows = rpcSpec.columns.map((c) => [c.header, cell(first[c.field])]);
    } else {
      sectionRows = rows.map((r) => rpcSpec.columns.map((c) => cell(r[c.field])));
    }
    if (sectionRows.length > 0) anyRows = true;
    sections.push({ title: rpcSpec.section, kind: rpcSpec.render, headers, rows: sectionRows });
  }

  const status: ReadModelStatus = anyRows ? (notes.length > 0 ? "degraded" : "ok") : reachedAny ? "missing" : "error";
  return { kind: "generic", type: spec.domain, label: spec.label, status, generatedAt: opts.now, sections, notes };
}
