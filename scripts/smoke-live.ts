import { getEnv, checkProviderStatus, printProviderStatus } from "../src/runtime/env.js";
import { SupabaseLiveClient } from "../src/supabase/live-client.js";
import { verifyCoreTables } from "../src/supabase/migrations.js";
import { TelegramHttpSender } from "../src/telegram/sender.js";

const env = getEnv();
const statuses = checkProviderStatus(env);
printProviderStatus(statuses);

const supabaseConfigured = statuses.find((status) => status.provider === "supabase")?.configured ?? false;
if (supabaseConfigured) {
  const client = new SupabaseLiveClient(env);
  const tables = await verifyCoreTables(client);
  console.log(`supabase debug_events: ${tables.debug_events ? "present" : "missing"}`);
  console.log(`supabase action_tokens: ${tables.action_tokens ? "present" : "missing"}`);
  if (env.ALLOW_LIVE_SMOKE_MUTATION === "true") {
    await client.insertSmokeDebugEvent(`smoke-${Date.now()}`);
    console.log("supabase mutation smoke: ok");
  } else {
    console.log("supabase mutation smoke: skipped; set ALLOW_LIVE_SMOKE_MUTATION=true to enable");
  }
}

const telegramConfigured = Boolean(env.TELEGRAM_BOT_TOKEN);
if (telegramConfigured) {
  const sender = new TelegramHttpSender(env);
  console.log(`telegram getMe: ${(await sender.getMe()) ? "ok" : "error"}`);
  const sendResult = await sender.sendOptionalTestMessage("HartOS live smoke test");
  console.log(`telegram test send: ${sendResult}`);
}
