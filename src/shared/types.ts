export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_URL?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ALLOWED_USER_IDS?: string;
  TELEGRAM_ALLOWED_CHAT_IDS?: string;
  OPENAI_API_KEY?: string;
  DEBUG_CHANNEL_ID?: string;
  TEST_TELEGRAM_CHAT_ID?: string;
  TRIGGER_SECRET_KEY?: string;
  CLOUDFLARE_WORKER_URL?: string;
  ENABLE_DEBUG_EVENTS?: string;
  ALLOW_LIVE_SMOKE_MUTATION?: string;
  ALLOW_TELEGRAM_TEST_SEND?: string;
  APP_ENV?: string;
  // Phase 5: deployment gates
  ALLOW_SUPABASE_MIGRATION_APPLY?: string;
  ALLOW_CLOUDFLARE_DEPLOY?: string;
  ALLOW_TELEGRAM_WEBHOOK_REGISTER?: string;
  CONFIRM_PRODUCTION_DEPLOY?: string;
  // Phase 5: staging profile
  STAGING_SUPABASE_URL?: string;
  STAGING_CLOUDFLARE_WORKER_URL?: string;
  STAGING_TELEGRAM_WEBHOOK_URL?: string;
  // Phase 5: production profile
  PRODUCTION_SUPABASE_URL?: string;
  PRODUCTION_CLOUDFLARE_WORKER_URL?: string;
  PRODUCTION_TELEGRAM_WEBHOOK_URL?: string;
  // Phase 6: provisioning gates
  ALLOW_AUTO_PROVISION?: string;
  CONFIRM_STAGING_PROVISION?: string;
  ALLOW_GITHUB_PROVISION?: string;
  ALLOW_SUPABASE_PROVISION?: string;
  ALLOW_CLOUDFLARE_PROVISION?: string;
  ALLOW_TRIGGER_PROVISION?: string;
  ALLOW_TELEGRAM_PROVISION?: string;
  ALLOW_OPENAI_VERIFY?: string;
  // Phase 7A: GitHub provisioning
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;       // GitHub username or org name
  GITHUB_ORG?: string;         // Alias for GITHUB_OWNER (org-only context)
  GITHUB_REPO_NAME?: string;
  GITHUB_PRIVATE_REPO?: string; // "true" = private repo (default)
  GITHUB_DEFAULT_BRANCH?: string; // default: "main"
  GITHUB_DESCRIPTION?: string;
  GITHUB_HOMEPAGE?: string;
  ALLOW_GITHUB_PUSH?: string;
  // Phase 7A: OpenAI
  OPENAI_MODEL?: string; // default: "gpt-4o"
  // Phase 7D: Supabase provisioning
  SUPABASE_ACCESS_TOKEN?: string;         // Management API token (for project creation)
  SUPABASE_PROJECT_REF?: string;          // Project reference ID
  SUPABASE_ORG_ID?: string;              // Organization ID (for project creation)
  SUPABASE_REGION?: string;              // Region (for project creation)
  SUPABASE_DB_PASSWORD?: string;         // DB password (for project creation — never logged)
  ALLOW_SUPABASE_PROJECT_CREATE?: string;
  // Phase 7C: Telegram provisioning
  TELEGRAM_BOT_NAME?: string;  // optional display name, used in safe summaries
  // Phase 7B: Cloudflare provisioning
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKER_NAME?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_ROUTE?: string;
  CLOUDFLARE_ENVIRONMENT?: string; // wrangler environment name (staging|production)
  ALLOW_CLOUDFLARE_SECRET_UPLOAD?: string;
  // Phase 7E: Trigger.dev provisioning
  TRIGGER_PROJECT_ID?: string;
  TRIGGER_API_URL?: string;        // default: https://api.trigger.dev
  TRIGGER_ENVIRONMENT?: string;    // staging | production
  TRIGGER_EXPECTED_TASKS?: string; // comma-separated expected task names
  ALLOW_TRIGGER_TASK_REGISTER?: string;
  ALLOW_TRIGGER_DEPLOY?: string;
  // Phase 9: production promotion gates
  ALLOW_PRODUCTION_PROMOTION?: string;
  REQUIRE_STAGING_SUCCESS?: string;        // "true" = require staging success before prod (default behavior)
  ALLOW_PARTIAL_STAGING_PROMOTION?: string; // "true" = allow promoting from partial staging
  ALLOW_ROLLBACK_EXECUTION?: string;
  // Phase 10: bootstrap gates
  ALLOW_BOOTSTRAP_PROVISION?: string;
  CONFIRM_BOOTSTRAP_PROVISION?: string;
  // ALLOW_CLOUDFLARE_SECRET_UPLOAD already defined in Phase 7B above
  ALLOW_LAUNCH_NOTIFICATIONS?: string;
  // Phase 11B: Beezulbub live scout
  BEEZULBUB_LIVE_SEARCH?: string;
  BEEZULBUB_MAX_CANDIDATES?: string;
  BEEZULBUB_ALLOW_NETWORK?: string;
  BEEZULBUB_ALLOW_CLONE?: string;
  // Phase 11C: pack generation
  BEEZULBUB_ALLOW_PACK_GENERATE?: string;
  BEEZULBUB_PACK_OUTPUT_DIR?: string;
  // Phase 11D: pack governance + capability registry
  BEEZULBUB_ALLOW_PACK_PROMOTE?: string;
  BEEZULBUB_CAPABILITY_REGISTRY_PATH?: string;
  BEEZULBUB_PROVENANCE_LEDGER_PATH?: string;
  // Phase 11E: pack implementation engine
  BEEZULBUB_ALLOW_PACK_IMPLEMENT?: string;
  // Phase 11J: Cloudflare hosted cockpit (deploy gated, blocked by default)
  CLOUDFLARE_PROJECT_NAME?: string;
  CLOUDFLARE_COCKPIT_URL?: string;
  CLOUDFLARE_COCKPIT_ALLOWED_ORIGIN?: string;
  CONFIRM_CLOUDFLARE_DEPLOY?: string;
  ALLOW_CLOUDFLARE_COCKPIT_DEPLOY?: string;
  // Phase 16: hosted cockpit auth + live read models (Worker env / wrangler secrets)
  HARTOS_COCKPIT_ACCESS_TOKEN?: string;
  HARTOS_COCKPIT_REQUIRE_AUTH?: string;
  HARTOS_COCKPIT_DEV_AUTH_BYPASS?: string;
  HARTOS_OPS_SUPABASE_URL?: string;
  HARTOS_OPS_SUPABASE_READONLY_KEY?: string;
  HARTOS_FITNESS_SUPABASE_URL?: string;
  HARTOS_FITNESS_SUPABASE_READONLY_KEY?: string;
  HARTOS_FITNESS_USER_ID?: string;
  HARTOS_FITNESS_AGENT_ID?: string;
}

export interface GeneratedCommand {
  name: string;
  description: string;
  approvalRequired: boolean;
  riskyMutation: boolean;
  finalState: string;
}

export const GENERATED_COMMANDS = [
  {
    "name": "analyse",
    "description": "Analyse an uploaded document",
    "approvalRequired": false,
    "riskyMutation": false,
    "finalState": "Row in reports table with status=done, preview delivered to chat, debug_event with outcome=ok"
  },
  {
    "name": "apply",
    "description": "Apply approved analysis to ClickUp",
    "approvalRequired": true,
    "riskyMutation": true,
    "finalState": "ClickUp task updated, action_tokens.consumed_at set, audit row written, debug_event outcome=ok"
  }
] as const satisfies readonly GeneratedCommand[];

export interface TelegramSender {
  sendMessage(chatId: string, text: string): Promise<void>;
}

export interface TriggerEnqueue {
  enqueue(command: string, payload: Record<string, unknown>): Promise<void>;
}

export interface SupabaseClient {
  insertDebugEvent(event: DebugEventInput): Promise<void>;
  insertCommandEvent(event: CommandEventInput): Promise<void>;
}

export interface LlmProvider {
  complete(prompt: string): Promise<string>;
}

export interface DebugEventInput {
  traceId: string;
  runtime: "cloudflare" | "trigger" | "local";
  route: string;
  stage: string;
  outcome: "ok" | "error" | "degraded" | "skipped";
  failureCode?: string;
  metadata?: Record<string, unknown>;
}

export interface CommandEventInput {
  traceId: string;
  route: string;
  status: "queued" | "running" | "ok" | "error" | "degraded" | "skipped";
  inputJson?: Record<string, unknown>;
  resultJson?: Record<string, unknown>;
}

export interface RuntimeDeps {
  sender: TelegramSender;
  trigger: TriggerEnqueue;
  supabase: SupabaseClient;
}

export function generatedCommandNames(): string[] {
  return GENERATED_COMMANDS.map((command) => command.name);
}

export function isGeneratedCommand(name: string): boolean {
  return generatedCommandNames().includes(name);
}
