/**
 * src/runtime/runtime-layer-gates.ts
 *
 * Phase 18D — gate matrix for the first runtime-layer mutation (deploy a generated agent's
 * Cloudflare Worker + upload its secrets + register Trigger.dev tasks + point its Telegram
 * webhook). This is the first phase that touches external COMPUTE and TRAFFIC.
 *
 * Pure module: reads a plain env record (+ the values discovered from the scaffold/Telegram),
 * returns a verdict. No fs, no network. Mirrors src/supabase/data-layer-gates.ts.
 *
 * Posture (one all-or-nothing gate — Hart's locked 18D decision; a partially-provisioned runtime
 * is worse than none, so we do NOT gate per-step):
 *   ALL of the following must hold for a single runtime apply:
 *     - ALLOW_RUNTIME_PROVISION = "true"
 *     - CONFIRM_RUNTIME_MUTATION = "true"
 *     - HARTOS_TARGET_ENV ∈ {staging, test}
 *     - CONFIRM_CLOUDFLARE_WORKER_NAME === <worker name parsed from the scaffold wrangler>
 *       (typo guard — you confirm the literal worker name, not just "yes")
 *     - CONFIRM_TELEGRAM_BOT_ID === <bot id from getMe> WHEN a webhook step will run (typo guard
 *       against silently STEALING another bot's webhook — a bot token has exactly one webhook)
 *   With ANY missing/closed → dry-run only (the orchestrator mutates nothing).
 *
 * Production is HARD-REFUSED unconditionally (same as 18C): a production env label is blocked even
 * if a confirm gate were set. Production runtime is deferred to a later phase.
 *
 * ALLOW_RUNTIME_OVERWRITE is a SEPARATE opt-in (the destructive analog of 18C's ALLOW_DESTRUCTIVE_SQL):
 * required only when a Worker / webhook ALREADY exists for the target — `wrangler deploy` is an
 * upsert and `setWebhook` silently overwrites, so overwriting something we didn't create is refused
 * unless this is explicitly opened.
 */

export const PROVISION_GATE = "ALLOW_RUNTIME_PROVISION";
export const MUTATION_CONFIRM_GATE = "CONFIRM_RUNTIME_MUTATION";
export const OVERWRITE_GATE = "ALLOW_RUNTIME_OVERWRITE";

export const TARGET_ENV_KEY = "HARTOS_TARGET_ENV";
export const WORKER_NAME_CONFIRM_KEY = "CONFIRM_CLOUDFLARE_WORKER_NAME";
export const BOT_ID_CONFIRM_KEY = "CONFIRM_TELEGRAM_BOT_ID";

/** Secret-bearing keys — presence is surfaced as booleans ONLY; values never read here. */
export const CLOUDFLARE_API_TOKEN_KEY = "CLOUDFLARE_API_TOKEN";
export const TELEGRAM_BOT_TOKEN_KEY = "TELEGRAM_BOT_TOKEN";
export const TRIGGER_SECRET_KEY_KEY = "TRIGGER_SECRET_KEY";

export type RuntimeTargetEnv = "staging" | "test";
const ALLOWED_ENVS: readonly string[] = ["staging", "test"];

/** Values discovered outside env (from the scaffold wrangler + a Telegram getMe), used for typo guards. */
export interface RuntimeGateExpectations {
  /** Worker name parsed from the scaffold wrangler config. */
  workerName?: string | null;
  /** Bot id (from getMe) — only enforced when a webhook step will actually run. */
  botId?: string | null;
  /** True when the runtime pipeline includes the Telegram webhook step (enforces BOT_ID confirm). */
  webhookStepPlanned?: boolean;
}

export interface RuntimeGateConfig {
  /** True only when every gate/key required for a real runtime apply is present and consistent. */
  allowProvision: boolean;
  /** True when the overwrite override gate is open (needed if a worker/webhook already exists). */
  allowOverwrite: boolean;
  /** Hard block (e.g. production label) — apply is refused regardless of gates. */
  hardBlock: string | null;
  /** Human-readable names/values of what's missing for a real apply (empty = ready). */
  missing: string[];
  /** Resolved selection (safe — no secrets). */
  targetEnv: string | null;
  confirmedWorkerName: string | null;
  confirmedBotId: string | null;
  /** Whether the provider credentials were provided (booleans only — never the values). */
  hasCloudflareToken: boolean;
  hasTelegramToken: boolean;
  hasTriggerKey: boolean;
}

export function readRuntimeGates(
  env: Record<string, string | undefined>,
  expected: RuntimeGateExpectations = {}
): RuntimeGateConfig {
  const missing: string[] = [];

  const provisionGate = env[PROVISION_GATE] === "true";
  const mutationConfirm = env[MUTATION_CONFIRM_GATE] === "true";
  const targetEnv = env[TARGET_ENV_KEY]?.trim().toLowerCase() || null;
  const confirmedWorkerName = env[WORKER_NAME_CONFIRM_KEY]?.trim() || null;
  const confirmedBotId = env[BOT_ID_CONFIRM_KEY]?.trim() || null;

  const expectedWorker = expected.workerName?.trim() || null;
  const expectedBotId = expected.botId != null ? String(expected.botId).trim() : null;
  const webhookPlanned = expected.webhookStepPlanned !== false; // default: webhook IS part of the pipeline

  // ── Hard block: production label is refused, full stop (same posture as 18C). ──
  let hardBlock: string | null = null;
  if (targetEnv === "production" || targetEnv === "prod") {
    hardBlock =
      `${TARGET_ENV_KEY}=${targetEnv} is refused in Phase 18D. Production runtime deploy is deferred ` +
      `to a later phase. Use a staging/test target only.`;
  }

  // ── Gate/key presence ──
  if (!provisionGate) missing.push(`${PROVISION_GATE}=true`);
  if (!mutationConfirm) missing.push(`${MUTATION_CONFIRM_GATE}=true`);

  // Env label must be staging|test.
  if (!targetEnv) {
    missing.push(`${TARGET_ENV_KEY}=staging|test`);
  } else if (!ALLOWED_ENVS.includes(targetEnv) && hardBlock === null) {
    missing.push(`${TARGET_ENV_KEY} must be one of: ${ALLOWED_ENVS.join(", ")} (got "${targetEnv}")`);
  }

  // Worker-name confirm must equal the parsed worker name exactly (typo guard).
  if (!confirmedWorkerName) {
    missing.push(`${WORKER_NAME_CONFIRM_KEY}=<worker name from scaffold wrangler>`);
  } else if (expectedWorker && confirmedWorkerName !== expectedWorker) {
    missing.push(
      `${WORKER_NAME_CONFIRM_KEY} must equal the scaffold worker name exactly (expected "${expectedWorker}" — refusing to guess)`
    );
  }

  // Bot-id confirm — only enforced when a webhook step will run (it's the webhook-theft guard).
  if (webhookPlanned) {
    if (!confirmedBotId) {
      missing.push(`${BOT_ID_CONFIRM_KEY}=<telegram bot id>`);
    } else if (expectedBotId && confirmedBotId !== expectedBotId) {
      missing.push(
        `${BOT_ID_CONFIRM_KEY} must equal the bot id reported by getMe exactly (expected "${expectedBotId}") — refusing on mismatch to avoid stealing another bot's webhook`
      );
    }
  }

  const allowProvision = hardBlock === null && missing.length === 0;

  return {
    allowProvision,
    allowOverwrite: env[OVERWRITE_GATE] === "true",
    hardBlock,
    missing,
    targetEnv,
    confirmedWorkerName,
    confirmedBotId,
    hasCloudflareToken: Boolean(env[CLOUDFLARE_API_TOKEN_KEY]?.trim()),
    hasTelegramToken: Boolean(env[TELEGRAM_BOT_TOKEN_KEY]?.trim()),
    hasTriggerKey: Boolean(env[TRIGGER_SECRET_KEY_KEY]?.trim()),
  };
}

/** Names of every gate this phase understands, for display/summary. */
export function runtimeGateNames(): string[] {
  return [PROVISION_GATE, MUTATION_CONFIRM_GATE, OVERWRITE_GATE];
}
