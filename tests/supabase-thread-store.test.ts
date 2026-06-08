/**
 * tests/supabase-thread-store.test.ts — Phase D.
 *
 * The Node-side thread write store (mirrors supabase-proposal-store): an injected
 * Queryable spy, an idempotent upsert keyed on thread_id, and the same secret
 * guard the proposal store uses — never persist secret-looking content. No live DB.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SupabaseThreadStore, type Queryable } from "../src/cockpit/threads/supabase-thread-store.js";
import type { CockpitThread, CockpitOrchestratorResponse } from "../src/cockpit/cockpit-types.js";

const NOW = "2026-06-08T00:00:00Z";
const resp = (over: Partial<CockpitOrchestratorResponse>): CockpitOrchestratorResponse => over as unknown as CockpitOrchestratorResponse;

function thread(over: Partial<CockpitThread> = {}): CockpitThread {
  return {
    threadId: "thread-1",
    createdAt: NOW,
    updatedAt: NOW,
    entries: [{ requestId: "r1", request: "hello", createdAt: NOW, response: resp({ intent: "daily_brief", intentSummary: "ok" }) }],
    ...over,
  };
}

class SpyDb implements Queryable {
  calls: { text: string; params?: unknown[] }[] = [];
  async query(text: string, params?: unknown[]): Promise<{ rowCount?: number | null; rows: unknown[] }> {
    this.calls.push({ text, params });
    return { rowCount: 1, rows: [] };
  }
}

describe("supabase thread store — Node write (Phase D)", () => {
  it("upserts a thread with positional params, idempotent on thread_id", async () => {
    const db = new SpyDb();
    await new SupabaseThreadStore(db).upsert(thread());
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0]!.text, /insert into public\.cockpit_threads/);
    assert.match(db.calls[0]!.text, /on conflict \(thread_id\) do update/);
    assert.equal(db.calls[0]!.params![0], "thread-1");
    assert.equal(db.calls[0]!.params![3], 1, "entry_count");
  });

  it("refuses to persist secret-looking content (same guard as proposals)", async () => {
    const db = new SpyDb();
    const secretThread = thread({
      entries: [{ requestId: "r1", request: "my key is sk-" + "a".repeat(40), createdAt: NOW, response: resp({}) }],
    });
    await assert.rejects(() => new SupabaseThreadStore(db).upsert(secretThread), /secret-looking/);
    assert.equal(db.calls.length, 0, "no write attempted");
  });

  it("upsertMany counts results without aborting the batch", async () => {
    const db = new SpyDb();
    const res = await new SupabaseThreadStore(db).upsertMany([thread({ threadId: "thread-1" }), thread({ threadId: "thread-2" })]);
    assert.equal(res.upserted, 2);
    assert.equal(res.failed, 0);
    assert.deepEqual(res.skipped, []);
  });
});
