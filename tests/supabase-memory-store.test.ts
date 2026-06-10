/**
 * tests/supabase-memory-store.test.ts
 *
 * Step 2b — the durable MemoryStore + the Worker-safe coercer, exercised with NO live DB.
 * A FakeDb simulates the day-keyed table so we pin: round-trip read/save, the
 * make-equal prune semantics, and the defensive RPC-row coercion.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SupabaseMemoryStore,
  type Queryable,
  MEMORY_SNAPSHOT_UPSERT_SQL,
  MEMORY_SNAPSHOT_SELECT_SQL,
  MEMORY_SNAPSHOT_PRUNE_SQL,
  MEMORY_SNAPSHOT_DELETE_ALL_SQL,
} from "../src/awareness/supabase-memory-store.js";
import { coerceCockpitMemoryRows, coerceMemorySnapshot } from "../src/awareness/cockpit-memory-spine.js";
import type { MemorySnapshot } from "../src/awareness/executive-memory.js";

function snap(day: string, riskSubjects: string[] = ["ops stale"]): MemorySnapshot {
  return {
    at: `${day}T08:00:00.000Z`,
    riskSubjects,
    driftSubjects: [],
    opportunitySubjects: [],
    blindSpotSubjects: [],
    metrics: [{ key: "risk_count", value: riskSubjects.length }],
  };
}

/** A fake day-keyed table that honours the store's upsert / select / prune / delete SQL. */
class FakeDb implements Queryable {
  rows = new Map<string, { day: string; captured_at: string; snapshot: MemorySnapshot }>();
  async query(text: string, params?: unknown[]): Promise<{ rowCount?: number | null; rows: unknown[] }> {
    if (text === MEMORY_SNAPSHOT_UPSERT_SQL) {
      const [day, capturedAt, json] = params as [string, string, string];
      this.rows.set(day, { day, captured_at: capturedAt, snapshot: JSON.parse(json) as MemorySnapshot });
      return { rowCount: 1, rows: [] };
    }
    if (text === MEMORY_SNAPSHOT_SELECT_SQL) {
      const sorted = [...this.rows.values()].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
      return { rowCount: sorted.length, rows: sorted.map((r) => ({ snapshot: r.snapshot })) };
    }
    if (text === MEMORY_SNAPSHOT_PRUNE_SQL) {
      const keep = new Set((params?.[0] as string[]) ?? []);
      for (const k of [...this.rows.keys()]) if (!keep.has(k)) this.rows.delete(k);
      return { rowCount: 0, rows: [] };
    }
    if (text === MEMORY_SNAPSHOT_DELETE_ALL_SQL) {
      this.rows.clear();
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`unexpected SQL: ${text}`);
  }
}

describe("SupabaseMemoryStore — durable, make-equal semantics", () => {
  it("round-trips save → read (oldest-first)", async () => {
    const db = new FakeDb();
    const store = new SupabaseMemoryStore(db);
    const list = [snap("2026-06-08"), snap("2026-06-09"), snap("2026-06-10")];
    await store.save(list);
    const got = await store.read();
    assert.deepEqual(got.map((s) => s.at), list.map((s) => s.at));
  });

  it("save makes the table EQUAL the list (prunes dropped days)", async () => {
    const db = new FakeDb();
    const store = new SupabaseMemoryStore(db);
    await store.save([snap("2026-06-08"), snap("2026-06-09"), snap("2026-06-10")]);
    // A later policied list dropped the oldest day.
    await store.save([snap("2026-06-09"), snap("2026-06-10")]);
    const got = await store.read();
    assert.deepEqual(got.map((s) => s.at.slice(0, 10)), ["2026-06-09", "2026-06-10"]);
  });

  it("upserts by UTC day (same day replaces, never duplicates)", async () => {
    const db = new FakeDb();
    const store = new SupabaseMemoryStore(db);
    await store.save([snap("2026-06-10", ["a"])]);
    await store.save([snap("2026-06-10", ["a", "b"])]);
    const got = await store.read();
    assert.equal(got.length, 1);
    assert.deepEqual(got[0]!.riskSubjects, ["a", "b"]);
  });

  it("empty list clears the store", async () => {
    const db = new FakeDb();
    const store = new SupabaseMemoryStore(db);
    await store.save([snap("2026-06-10")]);
    await store.save([]);
    assert.equal((await store.read()).length, 0);
  });
});

describe("coerceCockpitMemoryRows — defensive RPC coercion", () => {
  it("coerces {day, captured_at, snapshot} rows and drops malformed ones", () => {
    const rows = [
      { day: "2026-06-10", captured_at: "2026-06-10T08:00:00.000Z", snapshot: snap("2026-06-10") },
      { day: "2026-06-11", captured_at: "x", snapshot: { not: "a snapshot" } },
      null,
      "garbage",
    ];
    const got = coerceCockpitMemoryRows(rows);
    assert.equal(got.length, 1);
    assert.equal(got[0]!.at, "2026-06-10T08:00:00.000Z");
  });

  it("tolerates a row that IS the snapshot (no wrapper)", () => {
    const got = coerceCockpitMemoryRows([snap("2026-06-10")]);
    assert.equal(got.length, 1);
  });

  it("coerceMemorySnapshot returns null for non-objects / missing `at`", () => {
    assert.equal(coerceMemorySnapshot(null), null);
    assert.equal(coerceMemorySnapshot({ riskSubjects: [] }), null);
  });
});
