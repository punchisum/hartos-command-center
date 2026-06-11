/**
 * tests/cloudflare-live-cockpit-feeds.test.ts — live hosted threads/proposals
 * feeds (read-only fitness cockpit RPCs). No network: fetch is stubbed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchLiveThreads,
  fetchLiveProposals,
  defaultFeedClientFactory,
  COCKPIT_FEED_RPCS,
} from "../src/runtime/cloudflare-live-cockpit-feeds.js";
import { SupabaseReadClient, type FetchLike } from "../src/read-models/supabase-read-client.js";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";

function stubClient(rows: Record<string, Array<Record<string, unknown>>>): SupabaseReadClient {
  const fetchStub: FetchLike = async (url) => {
    const name = url.split("/rpc/")[1]?.split("?")[0] ?? "";
    const body = rows[name];
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  return new SupabaseReadClient(
    { url: "https://fixture.supabase.co", key: "anon-fixture-key", allowedTables: [], allowedRpcs: [...COCKPIT_FEED_RPCS] },
    fetchStub
  );
}

const THREAD_ROW = {
  thread_id: "thread-2026-06-11",
  created_at: "2026-06-11T01:00:00Z",
  updated_at: "2026-06-11T02:00:00Z",
  entry_count: 3,
  latest_request: "daily brief",
  latest_intent: "daily_brief",
  latest_summary: "All systems nominal.",
};

const PROPOSAL_ROW = {
  id: "prop-1",
  domain: "ops",
  action_type: "sync",
  title: "Resync ClickUp cards",
  risk_level: "low",
  status: "pending_approval",
  source_intent: "ops_status",
  spec_id: null,
  created_at: "2026-06-11T01:00:00Z",
  updated_at: null,
  expires_at: null,
};

describe("live cockpit feeds", () => {
  it("maps live threads", async () => {
    const view = await fetchLiveThreads({}, { clientFactory: () => stubClient({ get_cockpit_threads: [THREAD_ROW] }) });
    assert.ok(view);
    assert.equal(view.mode, "live_read_only");
    assert.equal(view.total, 1);
    assert.equal(view.threads[0]!.threadId, "thread-2026-06-11");
    assert.equal(view.threads[0]!.entryCount, 3);
    assert.equal(view.threads[0]!.latestIntent, "daily_brief");
  });

  it("maps live proposals and counts pending", async () => {
    const view = await fetchLiveProposals({}, {
      clientFactory: () => stubClient({ get_cockpit_proposals: [PROPOSAL_ROW, { ...PROPOSAL_ROW, id: "prop-2", status: "approved" }] }),
    });
    assert.ok(view);
    assert.equal(view.total, 2);
    assert.equal(view.pending, 1);
    assert.equal(view.executable, "disabled");
    assert.equal(view.proposals[0]!.executable, false);
  });

  it("returns null when the RPC fails (graceful degradation)", async () => {
    const view = await fetchLiveThreads({}, { clientFactory: () => stubClient({}) });
    assert.equal(view, null);
  });

  it("returns null when the feed env is not configured", async () => {
    assert.equal(await fetchLiveThreads({}), null);
    assert.equal(await fetchLiveProposals({}), null);
  });

  it("skips rows without an id and tolerates junk fields", async () => {
    const view = await fetchLiveThreads({}, {
      clientFactory: () => stubClient({ get_cockpit_threads: [{ thread_id: "", entry_count: "x" }, THREAD_ROW] }),
    });
    assert.ok(view);
    assert.equal(view.total, 1);
  });
});

describe("defaultFeedClientFactory service-role guard", () => {
  function fakeJwt(role: string): string {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role })}.signature`;
  }

  it("refuses a service-role key", () => {
    const client = defaultFeedClientFactory({
      HARTOS_FITNESS_SUPABASE_URL: "https://fixture.supabase.co",
      HARTOS_FITNESS_SUPABASE_READONLY_KEY: fakeJwt("service_role"),
    });
    assert.equal(client, undefined);
  });

  it("accepts an anon key", () => {
    const client = defaultFeedClientFactory({
      HARTOS_FITNESS_SUPABASE_URL: "https://fixture.supabase.co",
      HARTOS_FITNESS_SUPABASE_READONLY_KEY: fakeJwt("anon"),
    });
    assert.ok(client);
  });
});

describe("hosted worker /api/threads and /api/proposals fallbacks", () => {
  const env = { HARTOS_COCKPIT_DEV_AUTH_BYPASS: "true" };

  it("/api/threads serves an explicit empty fallback when nothing is configured", async () => {
    const res = await handleCockpitRequest(new Request("http://cockpit.test/api/threads"), env, { runtimeMode: "hosted" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { threads: unknown[]; note?: string };
    assert.deepEqual(body.threads, []);
    assert.ok(body.note?.includes("HARTOS_FITNESS_SUPABASE_URL"));
  });

  it("/api/proposals still serves the local-only note when no feed is configured", async () => {
    const res = await handleCockpitRequest(new Request("http://cockpit.test/api/proposals"), env, { runtimeMode: "hosted" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { available: boolean; mode: string };
    assert.equal(body.available, false);
    assert.equal(body.mode, "local_only");
  });
});
