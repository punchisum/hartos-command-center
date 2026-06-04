import { getEnv } from "../src/runtime/env.js";
import { SupabaseLiveClient } from "../src/supabase/live-client.js";
import { verifyCoreTables } from "../src/supabase/migrations.js";

const env = getEnv();
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("Supabase smoke skipped. SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.");
  process.exit(0);
}

const client = new SupabaseLiveClient(env);
const tables = await verifyCoreTables(client);
console.log(`debug_events: ${tables.debug_events ? "present" : "missing"}`);
console.log(`action_tokens: ${tables.action_tokens ? "present" : "missing"}`);
if (env.ALLOW_LIVE_SMOKE_MUTATION === "true") {
  await client.insertSmokeDebugEvent(`smoke-${Date.now()}`);
  console.log("Supabase mutation smoke: ok");
} else {
  console.log("Supabase mutation smoke: skipped; set ALLOW_LIVE_SMOKE_MUTATION=true to enable");
}
