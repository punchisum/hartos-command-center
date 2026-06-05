/**
 * src/runtime-provision/runtime-deploy-ops.ts
 *
 * Phase 18D — the single injectable boundary for the ACTUAL runtime mutations of a generated agent
 * (Worker deploy + secret upload + Trigger.dev task deploy + Telegram webhook). Mirrors 18C's
 * src/supabase/migration-apply-ops.ts: reached ONLY after the orchestrator confirms every runtime
 * gate is open. In tests it is always mocked — no real provider is ever touched by the suite.
 *
 * It COMPOSES the existing per-provider boundaries (cloudflare-local / telegram-local /
 * trigger-local) and adds a read-only worker-health probe, normalizing everything to one result
 * shape so the orchestrator stays provider-agnostic.
 *
 * Security rules (inherited from the underlying boundaries):
 *   - No API token, bot token, secret key, or secret VALUE is ever logged, returned, or written
 *     to a report/ledger. Secret values flow only into wrangler's stdin / a child env / an auth
 *     header inside the boundary.
 *   - Every message surfaced to callers is sanitized.
 */

import {
  realCloudflareOps,
  type CloudflareOps,
} from "../provisioning/cloudflare-local.js";
import {
  defaultTelegramOpsFactory,
  type TelegramOps,
} from "../provisioning/telegram-local.js";
import {
  defaultTriggerOpsFactory,
  type TriggerOps,
} from "../provisioning/trigger-local.js";

/** Normalized result — no secrets, ever. */
export interface RuntimeStepResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/** The composed runtime-mutation surface the orchestrator drives. */
export interface RuntimeDeployOps {
  // ── Cloudflare ──
  workerExists(wranglerEnv: string): Promise<RuntimeStepResult>;
  uploadSecrets(wranglerEnv: string, secrets: Record<string, string>): Promise<RuntimeStepResult>;
  deployWorker(wranglerEnv: string): Promise<RuntimeStepResult>;
  /** Read-only post-deploy health probe (GET <workerUrl>/health). Never mutates. */
  workerHealth(workerUrl: string): Promise<RuntimeStepResult>;
  // ── Trigger.dev ──
  deployTasks(projectDir: string, triggerEnv: string): Promise<RuntimeStepResult>;
  // ── Telegram ──
  getMe(): Promise<RuntimeStepResult>;
  getWebhookInfo(): Promise<RuntimeStepResult>;
  setWebhook(webhookUrl: string, secretToken?: string): Promise<RuntimeStepResult>;
  deleteWebhook(): Promise<RuntimeStepResult>;
}

function sanitize(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9_-]{20,}/gi, "bot[REDACTED]")
    .slice(0, 300);
}

const norm = (r: { success: boolean; message: string; data?: Record<string, unknown> }): RuntimeStepResult => ({
  success: r.success,
  message: r.message,
  ...(r.data ? { data: r.data } : {}),
});

/** Telegram ops that fail-closed (no token present) — never throws, never a network call. */
function noTokenTelegramOps(): TelegramOps {
  const fail = async (): Promise<{ success: false; message: string }> => ({
    success: false,
    message: "TELEGRAM_BOT_TOKEN not set — refusing any Telegram call.",
  });
  return {
    getMe: fail,
    setWebhook: fail,
    getWebhookInfo: fail,
    deleteWebhook: fail,
    sendMessage: fail,
  };
}

export interface RealRuntimeOpsConfig {
  env: Record<string, string | undefined>;
  cloudflareOps?: CloudflareOps;
  telegramOps?: TelegramOps;
  triggerOps?: TriggerOps;
  fetchImpl?: typeof fetch;
}

/**
 * Build the real composed ops. Telegram/Trigger boundaries need their secret (captured in closure,
 * never returned); they are read from env here. When a secret is absent the corresponding ops
 * fail-closed instead of making a malformed call.
 */
export function realRuntimeDeployOps(cfg: RealRuntimeOpsConfig): RuntimeDeployOps {
  const { env } = cfg;
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const cf = cfg.cloudflareOps ?? realCloudflareOps;

  const tgToken = env["TELEGRAM_BOT_TOKEN"]?.trim() || null;
  const tg = cfg.telegramOps ?? (tgToken ? defaultTelegramOpsFactory(tgToken, fetchImpl) : noTokenTelegramOps());

  const trgKey = env["TRIGGER_SECRET_KEY"]?.trim() || null;
  const trg =
    cfg.triggerOps ??
    (trgKey
      ? defaultTriggerOpsFactory(trgKey, "https://api.trigger.dev", fetchImpl)
      : null);

  return {
    workerExists: async (e) => norm(await cf.workerExists(e)),
    uploadSecrets: async (e, secrets) => norm(await cf.uploadSecrets(e, secrets)),
    deployWorker: async (e) => norm(await cf.deployWorker(e)),

    async workerHealth(workerUrl: string): Promise<RuntimeStepResult> {
      const url = `${workerUrl.replace(/\/$/, "")}/health`;
      try {
        const res = await fetchImpl(url, { method: "GET" });
        return {
          success: res.ok,
          message: res.ok ? `Worker health OK (HTTP ${res.status})` : `Worker health failed: HTTP ${res.status}`,
          data: { status: res.status },
        };
      } catch (err) {
        return {
          success: false,
          message: sanitize(`Worker health error: ${err instanceof Error ? err.message : "unknown"}`),
        };
      }
    },

    async deployTasks(projectDir: string, triggerEnv: string): Promise<RuntimeStepResult> {
      if (!trg) {
        return { success: false, message: "TRIGGER_SECRET_KEY not set — refusing Trigger.dev deploy." };
      }
      return norm(await trg.deployTasks(projectDir, triggerEnv));
    },

    getMe: async () => norm(await tg.getMe()),
    getWebhookInfo: async () => norm(await tg.getWebhookInfo()),
    setWebhook: async (u, s) => norm(await tg.setWebhook(u, s)),
    deleteWebhook: async () => norm(await tg.deleteWebhook()),
  };
}

/** All-success, no-network mock for tests. Override any method to drive a specific path. */
export function createMockRuntimeDeployOps(overrides: Partial<RuntimeDeployOps> = {}): RuntimeDeployOps {
  return {
    workerExists: async () => ({ success: true, message: "mock: no existing worker", data: { exists: false, checked: true } }),
    uploadSecrets: async (_e, secrets) => ({ success: true, message: `mock: uploaded ${Object.keys(secrets).length} secret(s)`, data: { count: Object.keys(secrets).length, names: Object.keys(secrets) } }),
    deployWorker: async () => ({ success: true, message: "mock: worker deployed" }),
    workerHealth: async () => ({ success: true, message: "mock: health OK", data: { status: 200 } }),
    deployTasks: async (_d, triggerEnv) => ({ success: true, message: `mock: tasks deployed to ${triggerEnv}` }),
    getMe: async () => ({ success: true, message: "mock: @testbot", data: { username: "testbot", botId: 123456 } }),
    getWebhookInfo: async () => ({ success: true, message: "mock: no webhook", data: { hasWebhook: false, pendingUpdates: 0, webhookUrl: "" } }),
    setWebhook: async () => ({ success: true, message: "mock: webhook set", data: { secretProvided: true } }),
    deleteWebhook: async () => ({ success: true, message: "mock: webhook deleted" }),
    ...overrides,
  };
}
