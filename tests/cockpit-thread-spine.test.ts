/**
 * tests/cockpit-thread-spine.test.ts — Phase D.
 *
 * Pure thread-spine helpers shared by the Node write store and the hosted Worker
 * reader (mirrors cockpit-proposal-spine): the read RPC name, row coercion (skips
 * junk, never throws), the row → summary mapping, and the CockpitThread → write-row
 * mapping that derives summary fields from the newest entry.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COCKPIT_THREADS_RPC,
  coerceCockpitThreadRows,
  mapRowToThreadSummary,
  threadToSpineRow,
  type CockpitThreadRow,
} from "../src/cockpit/threads/cockpit-thread-spine.js";
import type { CockpitThread, CockpitOrchestratorResponse } from "../src/cockpit/cockpit-types.js";

const NOW = "2026-06-08T00:00:00Z";
const resp = (over: Partial<CockpitOrchestratorResponse>): CockpitOrchestratorResponse => over as unknown as CockpitOrchestratorResponse;

describe("cockpit thread spine — pure helpers (Phase D)", () => {
  it("exposes the deployed read-only RPC name", () => {
    assert.equal(COCKPIT_THREADS_RPC, "get_cockpit_threads");
  });

  it("coerces well-formed rows and skips junk entries", () => {
    const rows = coerceCockpitThreadRows([
      { thread_id: "t1", created_at: NOW, updated_at: NOW, entry_count: 2, latest_request: "hi", latest_intent: "daily_brief", latest_summary: "ok" },
      null,
      { no_id: true },
      "garbage",
      { thread_id: "" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.thread_id, "t1");
    assert.equal(rows[0]!.entry_count, 2);
  });

  it("returns [] for non-array bodies (never throws)", () => {
    assert.deepEqual(coerceCockpitThreadRows(null), []);
    assert.deepEqual(coerceCockpitThreadRows({ rows: [] }), []);
  });

  it("maps a row to a summary with honest (non-fabricated) defaults", () => {
    const row: CockpitThreadRow = { thread_id: "t2", created_at: NOW, updated_at: NOW, entry_count: 1, latest_request: null, latest_intent: null, latest_summary: null };
    const s = mapRowToThreadSummary(row);
    assert.equal(s.threadId, "t2");
    assert.equal(s.entryCount, 1);
    assert.equal(s.latestRequest, "");
    assert.equal(s.latestIntent, "");
  });

  it("threadToSpineRow derives summary fields from the newest entry + round-trips payload", () => {
    const thread: CockpitThread = {
      threadId: "thread-abc", createdAt: NOW, updatedAt: NOW,
      entries: [
        { requestId: "r1", request: "first", createdAt: NOW, response: resp({ intent: "daily_brief", intentSummary: "older" }) },
        { requestId: "r2", request: "Create a tax agent", createdAt: NOW, response: resp({ intent: "build_agent", intentSummary: "Build plan drafted." }) },
      ],
    };
    const row = threadToSpineRow(thread);
    assert.equal(row.thread_id, "thread-abc");
    assert.equal(row.entry_count, 2);
    assert.equal(row.latest_request, "Create a tax agent");
    assert.equal(row.latest_intent, "build_agent");
    assert.equal(row.latest_summary, "Build plan drafted.");
    assert.equal((row.payload as { threadId: string }).threadId, "thread-abc");
  });
});
