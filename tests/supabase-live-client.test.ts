import { test } from "node:test";
import assert from "node:assert/strict";
import { SupabaseLiveClient } from "../src/supabase/live-client.js";

test("tableExists uses Supabase REST boundary with mocked fetch", async () => {
  const urls: string[] = [];
  const client = new SupabaseLiveClient(
    { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    { fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response("[]", { status: 200 });
    } }
  );
  assert.equal(await client.tableExists("debug_events"), true);
  assert.ok(urls[0].includes("/rest/v1/debug_events"));
});

test("insertSmokeDebugEvent requires configured env", async () => {
  const client = new SupabaseLiveClient({}, { fetchImpl: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(() => client.insertSmokeDebugEvent("trace"), /SUPABASE_URL/);
});
