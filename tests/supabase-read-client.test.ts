/**
 * tests/supabase-read-client.test.ts — Phase 11I.
 * The read client exposes NO mutation methods and only allows allowlisted
 * tables/RPCs. Uses a mocked fetch — no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SupabaseReadClient, SupabaseReadError, type FetchLike } from "../src/read-models/supabase-read-client.js";

function mockFetch(rows: unknown): { fetch: FetchLike; lastUrl: () => string; lastInit: () => Record<string, unknown> | undefined } {
  let url = "";
  let init: Record<string, unknown> | undefined;
  const fetch: FetchLike = async (u, i) => {
    url = u;
    init = i;
    return { ok: true, status: 200, json: async () => rows };
  };
  return { fetch, lastUrl: () => url, lastInit: () => init };
}

const config = {
  url: "https://example.supabase.co",
  key: "anon-readonly-key",
  allowedTables: ["clickup_cards", "sync_runs"],
  allowedRpcs: ["read_summary"],
};

describe("supabase read client — workerd fetch binding regression", () => {
  it("binds default global fetch to globalThis so workerd does not throw 'Illegal invocation'", async () => {
    // Cloudflare's workerd throws if global fetch is called with a `this` other
    // than the global scope. Node tolerates it, which is why this only ever broke
    // on the deployed Worker. Simulate the strict check here.
    const original = (globalThis as { fetch?: unknown }).fetch;
    function strictFetch(this: unknown): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }
    (globalThis as { fetch?: unknown }).fetch = strictFetch as unknown;
    try {
      // No fetchImpl injected → client must use the bound global fetch.
      const client = new SupabaseReadClient({
        url: "https://x.supabase.co",
        key: "anon",
        allowedTables: [],
        allowedRpcs: ["get_ops_overview"],
      });
      const out = await client.readRpc("get_ops_overview");
      assert.deepEqual(out, { ok: true });
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

describe("supabase read client", () => {
  it("exposes NO mutation methods", () => {
    const client = new SupabaseReadClient(config, mockFetch([]).fetch) as unknown as Record<string, unknown>;
    for (const m of ["insert", "update", "delete", "upsert", "delete_", "rpcMutation"]) {
      assert.equal(typeof client[m], "undefined", `must not expose ${m}`);
    }
  });

  it("selects rows from an allowlisted table via GET", async () => {
    const mock = mockFetch([{ id: 1, status: "open" }]);
    const client = new SupabaseReadClient(config, mock.fetch);
    const rows = await client.select("clickup_cards", { limit: 10, order: "created_at" });
    assert.equal(rows.length, 1);
    assert.equal(mock.lastInit()?.["method"], "GET");
    assert.ok(mock.lastUrl().includes("/rest/v1/clickup_cards"));
    assert.ok(mock.lastUrl().includes("limit=10"));
  });

  it("refuses tables that are not allowlisted", async () => {
    const client = new SupabaseReadClient(config, mockFetch([]).fetch);
    await assert.rejects(() => client.select("users"), SupabaseReadError);
  });

  it("refuses RPCs that are not allowlisted", async () => {
    const client = new SupabaseReadClient(config, mockFetch({}).fetch);
    await assert.rejects(() => client.readRpc("delete_everything"), SupabaseReadError);
  });

  it("allows an allowlisted read-only RPC", async () => {
    const mock = mockFetch({ ok: true });
    const client = new SupabaseReadClient(config, mock.fetch);
    await client.readRpc("read_summary", { since: "2026-01-01" });
    assert.ok(mock.lastUrl().includes("/rest/v1/rpc/read_summary"));
  });

  it("never logs the key in errors", async () => {
    const failing: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const client = new SupabaseReadClient(config, failing);
    await assert.rejects(
      () => client.select("clickup_cards"),
      (err: Error) => !err.message.includes("anon-readonly-key")
    );
  });
});
