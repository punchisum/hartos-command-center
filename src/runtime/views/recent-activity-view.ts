/**
 * src/runtime/views/recent-activity-view.ts
 *
 * A PURE, Worker-safe read-only cockpit view-builder for "recent activity" across the fleet —
 * a projection of recent `StateDeltaSignal`s (src/execution/state-delta.ts §13: what changed,
 * where, before→after, who's affected, how fresh). When a mutation executes, the system fans a
 * small `StateDeltaSignal` to the affected agents; this view turns a list of those deltas into a
 * read-only "what just changed across the fleet" panel for the hosted cockpit.
 *
 * It MIRRORS the honest available/unavailable shape the other live panels use
 * (`mutationCenterView` / `fleetBriefingView`):
 *   - null/undefined deltas ⇒ honest `available: false` + a note (no delta source configured) +
 *     zero items. Never fabricates a feed.
 *   - present (even empty) ⇒ `available: true`; each delta is projected to a SAFE read-only item.
 *
 * Read/control-plane projection ONLY. Like the views it mirrors:
 *   - it imports nothing that deploys, mutates, persists, fetches, or executes,
 *   - it never reads the filesystem, network, Supabase/pg, env, or the ambient clock,
 *   - `executable` stays the literal `"disabled"` — never a button, never a boolean true.
 *
 * The DATA path — who supplies the recent deltas (the executor fan-out, a buffer, a snapshot
 * field) — is a Commander/go-live wiring concern. This module is the pure view + honest
 * degradation only.
 *
 * WORKER-SAFE: `StateDeltaSignal` is imported as a TYPE only (`import type`). No value import of
 * state-delta / dispatch / pg / agent-contract is pulled in, so the Worker bundle stays clean.
 */

import type { StateDeltaSignal } from "../../execution/state-delta.js";

/** Default cap on projected items — honest, never a silent drop (see `truncated`). */
const DEFAULT_LIMIT = 20;

/**
 * A single projected, read-only recent-activity item. Pass-through of the delta's already-audited
 * fields plus a compact human before→after summary. No new facts are invented and no secret is
 * added by the projection.
 */
export interface RecentActivityItem {
  /** Who produced the delta — the adapter id (the delta's `source`). */
  source: string;
  /** The mutated agent's domain. */
  domain: StateDeltaSignal["domain"];
  /** Human-readable entity that changed. */
  changedEntity: string;
  /** The typed action that produced the change. */
  actionType: StateDeltaSignal["actionType"];
  /** Compact "before → after" key summary, derived purely from the delta's snapshots. */
  changeSummary: string;
  /** Agents that should react (the domain's agent label + Fleet Brain). */
  affectedAgents: string[];
  /** Honest freshness of the delta. */
  freshness: StateDeltaSignal["freshness"];
}

/**
 * The hosted "recent activity" panel view. When `available`, it carries the projected items
 * (newest-first per the caller's input order) and an honest `total`. When not, it mirrors the
 * other views' unavailable branch: a read-only, zero-item shell with an honest note. Both branches
 * stamp `executable: "disabled"`.
 */
export type RecentActivityView =
  | {
      available: true;
      mode: "read_only_snapshot";
      executable: "disabled";
      note: string;
      /** Total deltas the caller supplied (BEFORE any limit cap). */
      total: number;
      /** Whether the item list was capped by `limit` (honest — never a silent drop). */
      truncated: boolean;
      items: RecentActivityItem[];
    }
  | {
      available: false;
      mode: "read_only_snapshot";
      executable: "disabled";
      note: string;
      total: 0;
      truncated: false;
      items: [];
    };

/** Options for the projection. */
export interface RecentActivityOptions {
  /** Cap on the number of projected items (default {@link DEFAULT_LIMIT}). `<= 0` ⇒ no cap. */
  limit?: number;
}

/**
 * Compact, deterministic "before → after" summary from a delta's audited snapshots.
 *
 * Pure: reads only the two `Record`s on the delta, emits a stable `key: before → after` line per
 * changed key (sorted by key for determinism), and is honest when there is nothing to show. It
 * NEVER reaches outside the snapshots — no env, no clock, no secret added.
 */
function summarizeChange(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const b = before?.[key];
    const a = after?.[key];
    // Only surface keys whose value actually changed — a quiet, deterministic diff.
    if (stringify(b) === stringify(a)) continue;
    parts.push(`${key}: ${stringify(b)} → ${stringify(a)}`);
  }
  if (parts.length === 0) return "no field-level change recorded";
  return parts.join("; ");
}

/** Deterministic, bounded scalar rendering for the summary — never throws, never recurses deeply. */
function stringify(value: unknown): string {
  if (value === undefined) return "∅";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * PURE. Project a list of recent `StateDeltaSignal`s into the read-only recent-activity panel.
 *
 * - `null` / `undefined` ⇒ honest `available: false` (no delta source configured) + zero items.
 *   Mirrors the other views' unavailable branch; never fabricates a feed.
 * - present (even `[]`) ⇒ `available: true`. Each delta is projected to a {@link RecentActivityItem}
 *   in INPUT ORDER — the caller is expected to supply newest-first; this view does NOT invent a
 *   sort key (deltas carry no timestamp beyond `freshness`). An empty array yields an honest
 *   empty-state note that is DISTINCT from the unavailable note.
 * - `opts.limit` caps the item list (default {@link DEFAULT_LIMIT}). When the cap drops deltas,
 *   `truncated: true` and the note says so honestly — never a silent drop.
 *
 * No I/O, no fetch, no env, no clock — derives the view from the supplied deltas and nothing else.
 */
export function recentActivityView(
  deltas: StateDeltaSignal[] | null | undefined,
  opts: RecentActivityOptions = {},
): RecentActivityView {
  if (deltas == null) {
    return {
      available: false,
      mode: "read_only_snapshot",
      executable: "disabled",
      note:
        "Recent activity unavailable — no delta source is configured for this snapshot. " +
        "State deltas are produced by the gated executor when a mutation runs; wiring the " +
        "delta source into the hosted cockpit is a separate go-live step.",
      total: 0,
      truncated: false,
      items: [],
    };
  }

  const total = deltas.length;
  const rawLimit = opts.limit ?? DEFAULT_LIMIT;
  // `limit <= 0` means "no cap"; otherwise cap to the requested count.
  const limit = rawLimit > 0 ? rawLimit : total;
  const capped = deltas.slice(0, limit);
  const truncated = capped.length < total;

  const items: RecentActivityItem[] = capped.map((d) => ({
    source: d.source,
    domain: d.domain,
    changedEntity: d.changedEntity,
    actionType: d.actionType,
    changeSummary: summarizeChange(d.before, d.after),
    // Copy the array so the view never aliases the caller's delta (read-only invariant).
    affectedAgents: [...d.affectedAgents],
    freshness: d.freshness,
  }));

  let note: string;
  if (total === 0) {
    note =
      "Read-only recent-activity projection. No state deltas in this snapshot — the fleet has " +
      "recorded no recent mutations the cockpit can see. This is an empty feed, NOT an " +
      "unconfigured one.";
  } else if (truncated) {
    note =
      `Read-only recent-activity projection (most-recent-first per the supplied order). Showing ` +
      `${items.length} of ${total} deltas — capped at the limit; older deltas are not dropped, ` +
      `just not shown here.`;
  } else {
    note =
      "Read-only recent-activity projection (most-recent-first per the supplied order) of the " +
      "fleet's recent state deltas.";
  }

  return {
    available: true,
    mode: "read_only_snapshot",
    executable: "disabled",
    note,
    total,
    truncated,
    items,
  };
}
