/**
 * src/provisioning/adapters/telegram.ts
 *
 * Telegram provider adapter — Phase 7C real implementation.
 *
 * plan():    Returns verify_bot, register_webhook, verify_webhook, test_send steps.
 * verify():  Checks env vars; calls getMe+getWebhookInfo when ALLOW_TELEGRAM_PROVISION=true.
 * apply():   Registers webhook or sends test message (both gated).
 * rollback(): Returns manual rollback instructions.
 *
 * Security rules:
 *   - TELEGRAM_BOT_TOKEN is NEVER printed, logged, or included in messages.
 *   - TELEGRAM_WEBHOOK_SECRET is NEVER printed or logged.
 *   - API URLs contain the token — they must NEVER appear in logs or reports.
 *   - Only safe summaries are included: bot username, HTTP status codes, presence flags.
 */

import type {
  ProviderAdapter,
  ProvisionStep,
  ProvisionStepResult,
  ProvisionContext,
  ProviderVerificationResult,
  RollbackStep,
} from "../types.js";
import {
  type TelegramOps,
  defaultTelegramOpsFactory,
} from "../telegram-local.js";

// Required for configured status
const REQUIRED_ENV = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_URL",
  "TELEGRAM_ALLOWED_USER_IDS",
  "TELEGRAM_ALLOWED_CHAT_IDS",
];

// Recommended but optional (degrades security if absent)
const SECURITY_ENV = ["TELEGRAM_WEBHOOK_SECRET"];

const SAFE_TEST_MESSAGE =
  "HartOS generated agent Telegram smoke test passed.";

function safe(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/bot[A-Za-z0-9_-]{20,}/gi, "bot[REDACTED]")
    .slice(0, 200);
}

function result(
  step: ProvisionStep,
  status: ProvisionStepResult["status"],
  message: string
): ProvisionStepResult {
  return {
    step: { ...step, status },
    status,
    message: safe(message),
    timestamp: new Date().toISOString(),
  };
}

export class TelegramAdapter implements ProviderAdapter {
  readonly provider = "telegram" as const;
  private readonly telegramOpsFactory: (token: string) => TelegramOps;

  constructor(
    telegramOpsFactory: (token: string) => TelegramOps = defaultTelegramOpsFactory
  ) {
    this.telegramOpsFactory = telegramOpsFactory;
  }

  private getOps(context: ProvisionContext): TelegramOps | null {
    const token = context.env["TELEGRAM_BOT_TOKEN"];
    if (!token) return null;
    return this.telegramOpsFactory(token);
  }

  async plan(context: ProvisionContext): Promise<ProvisionStep[]> {
    const env = context.environment;
    const isProd = env === "production";

    return [
      {
        id: `telegram:verify_bot:${env}`,
        provider: "telegram",
        action: "verify_bot",
        environment: context.environment,
        mutation: false,
        description: "Verify Telegram bot token via getMe",
        safeSummary:
          "Read-only: calls Telegram getMe to confirm bot token is valid. " +
          "Never prints token.",
        status: "planned",
      },
      {
        id: `telegram:register_webhook:${env}`,
        provider: "telegram",
        action: "register_webhook",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_TELEGRAM_WEBHOOK_REGISTER",
        productionGateRequired: isProd,
        description: `Register Telegram webhook for ${context.agentName} (${env})`,
        safeSummary:
          "Calls Telegram setWebhook with TELEGRAM_WEBHOOK_URL. " +
          "Webhook secret is passed but never logged.",
        rollback: {
          description:
            "Remove webhook: call setWebhook with empty URL, or re-register previous URL.",
          command:
            "TELEGRAM_WEBHOOK_URL=<previous> ALLOW_TELEGRAM_WEBHOOK_REGISTER=true npm run telegram:register-webhook",
          notes: "Webhook removal is manual in Phase 7C.",
        },
        status: "planned",
      },
      {
        id: `telegram:verify_webhook:${env}`,
        provider: "telegram",
        action: "verify_webhook",
        environment: context.environment,
        mutation: false,
        description: "Verify Telegram webhook registration via getWebhookInfo",
        safeSummary:
          "Read-only: checks Telegram registered webhook URL matches TELEGRAM_WEBHOOK_URL.",
        status: "planned",
      },
      {
        id: `telegram:test_send:${env}`,
        provider: "telegram",
        action: "test_send",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_TELEGRAM_TEST_SEND",
        productionGateRequired: isProd,
        description: "Send a safe test message to debug/test chat",
        safeSummary:
          "Sends a fixed, safe test message to DEBUG_CHANNEL_ID or TEST_TELEGRAM_CHAT_ID.",
        rollback: {
          description: "No rollback needed — test message is read-only from a data perspective.",
          notes: "Delete the test message manually from the chat if needed.",
        },
        status: "planned",
      },
    ];
  }

  async verify(context: ProvisionContext): Promise<ProviderVerificationResult> {
    const token = context.env["TELEGRAM_BOT_TOKEN"];
    const webhookUrl = context.env["TELEGRAM_WEBHOOK_URL"];
    const webhookSecret = context.env["TELEGRAM_WEBHOOK_SECRET"];

    const missingRequired = REQUIRED_ENV.filter((k) => !context.env[k]);

    if (missingRequired.length > 0) {
      return {
        provider: "telegram",
        status: "missing_env",
        missingEnv: missingRequired,
        supportedActions: ["verify_bot", "register_webhook", "verify_webhook", "test_send"],
        unsupportedActions: [],
        nextAction: `Set ${missingRequired.join(", ")} to configure Telegram`,
        safeSummary: `Telegram not configured — missing: ${missingRequired.join(", ")}`,
      };
    }

    // Security degraded if no webhook secret
    const missingSecurityEnv = SECURITY_ENV.filter((k) => !context.env[k]);
    const hasMissingSecret = missingSecurityEnv.length > 0;

    // If gate is open, verify with Telegram API
    if (context.env["ALLOW_TELEGRAM_PROVISION"] === "true" && token) {
      const ops = this.getOps(context);
      if (!ops) {
        return this.configuredResult(hasMissingSecret, webhookUrl, "No ops available");
      }

      const getMeResult = await ops.getMe();
      if (!getMeResult.success) {
        return {
          provider: "telegram",
          status: "error",
          missingEnv: [],
          supportedActions: [],
          unsupportedActions: ["register_webhook"],
          nextAction: "Check TELEGRAM_BOT_TOKEN — bot verification failed",
          safeSummary: `Telegram bot verification failed: ${getMeResult.message}`,
        };
      }

      const botName =
        (getMeResult.data?.["username"] as string | undefined) ?? "unknown";

      // Check webhook if URL is configured
      if (webhookUrl) {
        const webhookResult = await ops.getWebhookInfo();
        if (webhookResult.success) {
          const registeredUrl = webhookResult.data?.["webhookUrl"] as string | undefined;
          const urlMatch = registeredUrl === webhookUrl;
          const hasWebhook = webhookResult.data?.["hasWebhook"] as boolean | undefined;

          if (!hasWebhook || !urlMatch) {
            return {
              provider: "telegram",
              status: "degraded",
              missingEnv: missingSecurityEnv,
              supportedActions: ["verify_bot", "verify_webhook"],
              unsupportedActions: [],
              nextAction: `Run register_webhook to set the webhook URL for @${botName}`,
              safeSummary:
                `Telegram bot @${botName} verified. ` +
                (hasWebhook ? "Webhook URL mismatch." : "No webhook registered.") +
                (hasMissingSecret ? " Missing webhook secret." : ""),
            };
          }

          return {
            provider: "telegram",
            status: hasMissingSecret ? "degraded" : "configured",
            missingEnv: missingSecurityEnv,
            supportedActions: ["verify_bot", "register_webhook", "verify_webhook", "test_send"],
            unsupportedActions: [],
            nextAction: hasMissingSecret
              ? "Set TELEGRAM_WEBHOOK_SECRET for improved security"
              : `Telegram @${botName} configured and webhook active`,
            safeSummary:
              `Telegram bot @${botName} verified. Webhook active.` +
              (hasMissingSecret ? " Degraded: no webhook secret." : ""),
          };
        }
      }

      return {
        provider: "telegram",
        status: hasMissingSecret ? "degraded" : "configured",
        missingEnv: missingSecurityEnv,
        supportedActions: ["verify_bot", "register_webhook", "verify_webhook", "test_send"],
        unsupportedActions: [],
        nextAction: `Telegram @${botName} verified. Register webhook to complete setup.`,
        safeSummary:
          `Telegram bot @${botName} verified.` +
          (hasMissingSecret ? " Degraded: no webhook secret." : " Webhook not checked."),
      };
    }

    // Gate not open — env-only check
    return this.configuredResult(hasMissingSecret, webhookUrl, undefined);
  }

  async apply(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    switch (step.action) {
      case "register_webhook":
        return this.applyRegisterWebhook(step, context);
      case "test_send":
        return this.applyTestSend(step, context);
      case "verify_bot":
        return this.applyVerifyBot(step, context);
      case "verify_webhook":
        return this.applyVerifyWebhook(step, context);
      default:
        return result(
          step,
          "not_implemented",
          `Telegram action ${step.action} not implemented in Phase 7C`
        );
    }
  }

  async rollback(
    step: RollbackStep,
    _context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    return {
      step: {
        id: "telegram:rollback",
        provider: "telegram",
        action: "register_webhook",
        environment: "local",
        mutation: false,
        description: step.description,
        safeSummary: "Manual rollback required",
        status: "skipped",
      },
      status: "skipped",
      message: `Rollback instruction: ${step.description} (manual — no auto-deletion in Phase 7C)`,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private configuredResult(
    hasMissingSecret: boolean,
    webhookUrl: string | undefined,
    extra: string | undefined
  ): ProviderVerificationResult {
    return {
      provider: "telegram",
      status: hasMissingSecret ? "degraded" : "configured",
      missingEnv: hasMissingSecret ? ["TELEGRAM_WEBHOOK_SECRET"] : [],
      supportedActions: ["verify_bot", "register_webhook", "verify_webhook", "test_send"],
      unsupportedActions: [],
      nextAction: hasMissingSecret
        ? "Set TELEGRAM_WEBHOOK_SECRET and set ALLOW_TELEGRAM_PROVISION=true to verify"
        : "Set ALLOW_TELEGRAM_PROVISION=true to call getMe and verify bot",
      safeSummary:
        `Telegram configured (env present).` +
        (webhookUrl ? " Webhook URL set." : " No webhook URL.") +
        (hasMissingSecret ? " Degraded: no webhook secret." : "") +
        (extra ? ` ${extra}` : ""),
    };
  }

  private async applyRegisterWebhook(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    // Secondary gate check
    if (context.env["ALLOW_TELEGRAM_WEBHOOK_REGISTER"] !== "true") {
      return result(
        step,
        "gate_missing",
        "Webhook registration requires ALLOW_TELEGRAM_WEBHOOK_REGISTER=true"
      );
    }

    const webhookUrl = context.env["TELEGRAM_WEBHOOK_URL"];
    if (!webhookUrl) {
      return result(step, "failed", "Missing TELEGRAM_WEBHOOK_URL");
    }

    const ops = this.getOps(context);
    if (!ops) {
      return result(step, "failed", "Missing TELEGRAM_BOT_TOKEN");
    }

    const webhookSecret = context.env["TELEGRAM_WEBHOOK_SECRET"];
    if (!webhookSecret) {
      // Allow but degrade: warn about missing secret
      const r = await ops.setWebhook(webhookUrl);
      if (r.success) {
        return result(
          step,
          "degraded",
          "Webhook registered without a webhook secret. Set TELEGRAM_WEBHOOK_SECRET for improved security."
        );
      }
      return result(step, "failed", `Webhook registration failed: ${r.message}`);
    }

    const r = await ops.setWebhook(webhookUrl, webhookSecret);
    if (r.success) {
      return result(step, "applied", "Webhook registered with secret token");
    }
    return result(step, "failed", `Webhook registration failed: ${r.message}`);
  }

  private async applyTestSend(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    if (context.env["ALLOW_TELEGRAM_TEST_SEND"] !== "true") {
      return result(
        step,
        "gate_missing",
        "Test send requires ALLOW_TELEGRAM_TEST_SEND=true"
      );
    }

    const chatId =
      context.env["TEST_TELEGRAM_CHAT_ID"] ?? context.env["DEBUG_CHANNEL_ID"];
    if (!chatId) {
      return result(
        step,
        "failed",
        "Missing TEST_TELEGRAM_CHAT_ID or DEBUG_CHANNEL_ID for test send"
      );
    }

    const ops = this.getOps(context);
    if (!ops) {
      return result(step, "failed", "Missing TELEGRAM_BOT_TOKEN");
    }

    const r = await ops.sendMessage(chatId, SAFE_TEST_MESSAGE);
    if (r.success) {
      return result(step, "applied", "Test message sent to debug chat");
    }
    return result(step, "failed", `Test send failed: ${r.message}`);
  }

  private async applyVerifyBot(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const ops = this.getOps(context);
    if (!ops) return result(step, "failed", "Missing TELEGRAM_BOT_TOKEN");
    const r = await ops.getMe();
    return r.success
      ? result(step, "verified", r.message)
      : result(step, "failed", r.message);
  }

  private async applyVerifyWebhook(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const ops = this.getOps(context);
    if (!ops) return result(step, "failed", "Missing TELEGRAM_BOT_TOKEN");

    const webhookUrl = context.env["TELEGRAM_WEBHOOK_URL"];
    const r = await ops.getWebhookInfo();
    if (!r.success) return result(step, "failed", r.message);

    const registeredUrl = r.data?.["webhookUrl"] as string | undefined;
    if (!registeredUrl) return result(step, "degraded", "No webhook currently registered");
    if (registeredUrl !== webhookUrl) {
      return result(
        step,
        "degraded",
        "Registered webhook URL does not match TELEGRAM_WEBHOOK_URL"
      );
    }
    return result(step, "verified", "Webhook URL matches");
  }
}
