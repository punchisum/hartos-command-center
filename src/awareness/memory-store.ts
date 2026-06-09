/**
 * src/awareness/memory-store.ts
 *
 * Executive Memory — the persistence CONTRACT + the pure capture policy that closes the
 * loop the Strategic Awareness + Executive Memory sprints opened:
 *
 *   State → Signals (depth) → Awareness (strategic) → Brief → Cockpit V2
 *                                  ▲                                  │
 *                                  └──────── Memory (this) ◄── snapshot ┘
 *
 * The Worker never reads a store (it stays read-only/stateless). A Node host owns I/O via the
 * `MemoryStore` port; everything decision-shaping here is PURE + deterministic and unit-tested
 * without any backend.
 *
 * Discipline (Parts G/J of the memory sprint — remember what matters, stay compact):
 *   - At most ONE snapshot per UTC day (dedupe — the newest wins). Capture is a daily heartbeat,
 *     not an event log; this is the single biggest noise control.
 *   - Prune to a rolling window (default 60 days) on every write.
 *   - Hard cap on total snapshots (default 120) — oldest fall off first.
 */

import type { MemorySnapshot } from "./executive-memory.js";

/** Storage port — implemented by a Node backend (local JSON, Supabase, KV…). Worker never uses it. */
export interface MemoryStore {
  /** Read the full snapshot history (any order; the policy sorts). */
  read(): Promise<MemorySnapshot[]>;
  /** Replace the stored history with the given (already-policied) list. */
  save(list: MemorySnapshot[]): Promise<void>;
}

export interface CapturePolicy {
  /** Rolling retention window in days (default 60). */
  windowDays?: number;
  /** Maximum snapshots retained (default 120). Oldest are dropped first. */
  maxSnapshots?: number;
}

const DEFAULT_WINDOW_DAYS = 60;
const DEFAULT_MAX = 120;
const DAY = 24 * 60 * 60 * 1000;

function dayKey(iso: string): string {
  // UTC calendar day — stable, locale-independent.
  return iso.slice(0, 10);
}

/**
 * Fold a new snapshot into the existing history under the compactness policy. PURE: returns a
 * new, sorted (oldest→newest), deduped, window-pruned, capped list. Same inputs → same output.
 *
 *   - dedupe-by-day: any existing snapshot on the new snapshot's UTC day is replaced by it.
 *   - prune: drop snapshots older than `windowDays` relative to the new snapshot.
 *   - cap: keep at most `maxSnapshots` most-recent.
 */
export function recordSnapshot(existing: MemorySnapshot[], snap: MemorySnapshot, policy: CapturePolicy = {}): MemorySnapshot[] {
  const windowDays = policy.windowDays ?? DEFAULT_WINDOW_DAYS;
  const max = policy.maxSnapshots ?? DEFAULT_MAX;
  const newDay = dayKey(snap.at);
  const newTime = Date.parse(snap.at);

  // Drop any same-day snapshot (newest wins) and anything with an unparseable timestamp.
  const kept = existing.filter((s) => {
    if (dayKey(s.at) === newDay) return false;
    return !Number.isNaN(Date.parse(s.at));
  });
  kept.push(snap);

  // Sort oldest→newest, prune to the window relative to the new snapshot, cap to most-recent.
  const sorted = kept.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const cutoff = Number.isNaN(newTime) ? -Infinity : newTime - windowDays * DAY;
  const windowed = sorted.filter((s) => Date.parse(s.at) >= cutoff);
  return windowed.length > max ? windowed.slice(windowed.length - max) : windowed;
}

/** In-memory store — for tests and ephemeral/dev hosts. Not durable. */
export class InMemoryMemoryStore implements MemoryStore {
  private list: MemorySnapshot[];
  constructor(seed: MemorySnapshot[] = []) {
    this.list = [...seed];
  }
  async read(): Promise<MemorySnapshot[]> {
    return [...this.list];
  }
  async save(list: MemorySnapshot[]): Promise<void> {
    this.list = [...list];
  }
}
