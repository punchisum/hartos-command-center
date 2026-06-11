/**
 * src/runtime/cloudflare-live-cockpit-feeds.ts
 *
 * Live cockpit feeds for the HOSTED Worker: threads + proposals read from the
 * fitness Supabase project's read-only cockpit RPCs (get_cockpit_threads /
 * get_cockpit_proposals — both SECURITY DEFINER, granted to anon, p_limit arg).
 *
 * Same doctrine as the Phase 16D read models:
 *   - READ-ONLY: the SupabaseReadClient has no mutation surface and only the
 *     two allowlisted RPCs are reachable.
 *   - Read-only ANON keys only; service-role keys are refused.
 *   - Graceful degradation: missing env or a failed read returns null and the
 *     Worker falls back to the local-only response. Never throws.
 */

import { SupabaseReadClient } from "../read-models/supabase-read-client.js";
import { isServiceRoleKey } from "../cockpit/sources/secret-guard.js";
import { HOSTED_READ_MODEL_ENV } from "./cloudflare-live-read-models.js";

type Env = Record<string, string | undefined>;
type Rec = Record<string, unknown>;

/** The only RPCs this feed may call. */
export const COCKPIT_FEED_RPCS = ["get_cockpit_threads", "get_cockpit_proposals"];
export const DEFAULT_FEED_LIMIT = 20;

export interface LiveThread {
  threadId: string;
  createdAt: string | null;
  updatedAt: string | null;
  entryCount: number | null;
  latestRequest: string | null;
  latestIntent: string | null;
  latestSummary: string | null;
}

export interface LiveThreadsView {
  available: true;
  mode: "live_read_only";
  origin: "fitness_supabase";
  total: number;
  threads: LiveThread[];
  note: string;
}

export interface LiveProposalsView {
  available: true;
  mode: "live_read_only";
  origin: "fitness_supabase";
  executable: "disabled";
  note: string;
  total: number;
  pending: number;
  proposals: {
    n: number;
    id: string;
    domain: string;
    riskLevel: string;
    title: string;
    status: string;
    executable: false;
  }[];
}

export type FeedClientFactory = (env: Env) => SupabaseReadClient | undefined;

/** Build the read-only client from the fitness read-model env. Refuses service-role keys. */
export function defaultFeedClientFactory(env: Env): SupabaseReadClient | undefined {
  const url = env[HOSTED_READ_MODEL_ENV.fitnessUrl];
  const key = env[HOSTED_READ_MODEL_ENV.fitnessKey];
  if (!url || !key) return undefined;
  if (isServiceRoleKey(key)) return undefined;
  return new SupabaseReadClient({
    url,
    key,
    allowedTables: [],
    allowedRpcs: [...COCKPIT_FEED_RPCS],
  });
}

export interface FeedOptions {
  limit?: number;
  /** Inject a client (tests). Defaults to the real anon-key client from env. */
  clientFactory?: FeedClientFactory;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function int(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

async function callFeedRpc(env: Env, name: string, limit: number, factory?: FeedClientFactory): Promise<Rec[] | null> {
  const client = (factory ?? defaultFeedClientFactory)(env);
  if (!client) return null;
  try {
    const body = await client.readRpc(name, { p_limit: limit });
    return Array.isArray(body) ? (body as Rec[]) : null;
  } catch {
    return null;
  }
}

/**
 * Live thread list for GET /api/threads. Returns null when the feed is not
 * configured or the read fails (caller serves the local-only fallback).
 */
export async function fetchLiveThreads(env: Env, options: FeedOptions = {}): Promise<LiveThreadsView | null> {
  const limit = options.limit ?? DEFAULT_FEED_LIMIT;
  const records = await callFeedRpc(env, "get_cockpit_threads", limit, options.clientFactory);
  if (!records) return null;
  const threads: LiveThread[] = [];
  for (const r of records) {
    const threadId = str(r["thread_id"]);
    if (!threadId) continue;
    threads.push({
      threadId,
      createdAt: str(r["created_at"]),
      updatedAt: str(r["updated_at"]),
      entryCount: int(r["entry_count"]),
      latestRequest: str(r["latest_request"]),
      latestIntent: str(r["latest_intent"]),
      latestSummary: str(r["latest_summary"]),
    });
  }
  return {
    available: true,
    mode: "live_read_only",
    origin: "fitness_supabase",
    total: threads.length,
    threads,
    note: "Live read-only thread feed from the cockpit RPCs (get_cockpit_threads). Nothing here is executable.",
  };
}

const PENDING_STATUSES = new Set(["draft", "pending_approval", "pending"]);

/**
 * Live proposal queue for GET /api/proposals. Returns null when the feed is
 * not configured or the read fails (caller serves the local-only fallback).
 */
export async function fetchLiveProposals(env: Env, options: FeedOptions = {}): Promise<LiveProposalsView | null> {
  const limit = options.limit ?? DEFAULT_FEED_LIMIT;
  const records = await callFeedRpc(env, "get_cockpit_proposals", limit, options.clientFactory);
  if (!records) return null;
  const proposals: LiveProposalsView["proposals"] = [];
  for (const r of records) {
    const id = str(r["id"]);
    if (!id) continue;
    proposals.push({
      n: proposals.length + 1,
      id,
      domain: str(r["domain"]) ?? "unknown",
      riskLevel: str(r["risk_level"]) ?? "unknown",
      title: str(r["title"]) ?? "(untitled proposal)",
      status: str(r["status"]) ?? "unknown",
      executable: false as const,
    });
  }
  const pending = proposals.filter((p) => PENDING_STATUSES.has(p.status)).length;
  return {
    available: true,
    mode: "live_read_only",
    origin: "fitness_supabase",
    executable: "disabled",
    note: "Live read-only proposal feed from the cockpit RPCs (get_cockpit_proposals). All proposals are dry-run only and cannot be executed from the hosted cockpit.",
    total: proposals.length,
    pending,
    proposals,
  };
}
