/**
 * tests/supabase-proposal-store.test.ts — Phase D.
 *
 * The Node-side write store upserts proposals into the Supabase spine. It is
 * driver-free by construction (an injected Queryable), so these tests use a fake
 * query spy — no live DB, no network. They verify the upsert SQL + positional
 * params, the secret guard (never persist a secret), and best-effort batching.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SupabaseProposalStore,
  COCKPIT_PROPOSALS_UPSERT_SQL,
  type Queryable,
} from "../src/cockpit/proposals/supabase-proposal-store.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

function item(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  return {
    id: "prop-1",
    domain: "ops",
    actionType: "ops_followup_plan",
    title: "Chase supplier",
    description: "",
    sourceIntent: "ops urgent",
    proposedPayload: {},
    expectedEffect: "",
    riskLevel: "medium",
    requiredApproval: "Hart",
    status: "pending_approval",
    createdAt: "2026-06-07T00:00:00Z",
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "",
    dryRunResult: null,
    executable: false,
    updatedAt: "2026-06-07T01:00:00Z",
    auditEvents: [],
    specId: null,
    ...over,
  };
}

describe("SupabaseProposalStore — Node write (Phase D)", () => {
  it("upsert issues the upsert SQL with positional params in column order", async () => {
    const calls: { text: string; params: unknown[] }[] = [];
    const db: Queryable = {
      query: async (text, params = []) => {
        calls.push({ text, params });
        return { rowCount: 1, rows: [] };
      },
    };
    await new SupabaseProposalStore(db).upsert(item({ specId: "spec-9" }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.text, COCKPIT_PROPOSALS_UPSERT_SQL);
    const p = calls[0]!.params;
    assert.equal(p[0], "prop-1"); // id
    assert.equal(p[1], "ops"); // domain
    assert.equal(p[2], "ops_followup_plan"); // action_type
    assert.equal(p[3], "Chase supplier"); // title
    assert.equal(p[4], "medium"); // risk_level
    assert.equal(p[5], "pending_approval"); // status
    assert.equal(p[7], "spec-9"); // spec_id
    assert.match(String(p[11]), /"id":"prop-1"/); // payload is the serialized item
  });

  it("refuses to upsert (throws, no DB call) when the item looks like it carries a secret", async () => {
    let calls = 0;
    const db: Queryable = {
      query: async () => {
        calls += 1;
        return { rowCount: 1, rows: [] };
      },
    };
    const leaky = item({ description: "leaked key sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" });
    await assert.rejects(() => new SupabaseProposalStore(db).upsert(leaky), /secret/i);
    assert.equal(calls, 0, "no DB write when a secret is detected");
  });

  it("upsertMany is best-effort: counts upserted, failed, and records skipped ids", async () => {
    const seen: unknown[] = [];
    const db: Queryable = {
      query: async (_text, params = []) => {
        seen.push(params[0]);
        if (params[0] === "boom") throw new Error("db down");
        return { rowCount: 1, rows: [] };
      },
    };
    const res = await new SupabaseProposalStore(db).upsertMany([
      item({ id: "a" }),
      item({ id: "boom" }),
      item({ id: "c" }),
    ]);
    assert.equal(res.upserted, 2);
    assert.equal(res.failed, 1);
    assert.deepEqual(res.skipped, ["boom"]);
    assert.deepEqual(seen, ["a", "boom", "c"]);
  });
});
