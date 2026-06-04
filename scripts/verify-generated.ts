import { existsSync } from "node:fs";

const requiredFiles = [
  "agent.yaml",
  "src/index.ts",
  "src/runtime/cloudflare-worker.ts",
  "src/runtime/env.ts",
  "src/runtime/provider-status.ts",
  "src/telegram/router.ts",
  "src/telegram/sender.ts",
  "src/telegram/register-webhook.ts",
  "src/trigger/jobs.ts",
  "src/trigger/enqueue.ts",
  "src/supabase/client.ts",
  "src/supabase/live-client.ts",
  "src/supabase/migrations.ts",
  "supabase/migrations/000001_core.sql",
  "supabase/migrations/000002_debug_events.sql",
  "supabase/migrations/000003_action_tokens.sql",
  "tests/runtime.test.ts",
  "tests/provider-status.test.ts",
  "tests/env.test.ts",
  "wrangler.toml.example",
];

const missing = requiredFiles.filter((file) => !existsSync(file));
if (missing.length > 0) {
  console.error(`Generated repo is missing files: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Generated repo verification passed.");
