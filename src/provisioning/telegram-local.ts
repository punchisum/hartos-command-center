/**
 * src/provisioning/telegram-local.ts
 *
 * Safe Telegram API boundary for the provisioning engine.
 *
 * All API calls use fetch. The bot token is NEVER logged or included in messages.
 * API URLs contain the token — they must never appear in logs or reports.
 * Exported as an injectable interface so tests can mock Telegram operations.
 */

export interface TelegramCommandResult {
  success: boolean;
  /** Safe message — no token, no secret, no raw response body. */
  message: string;
  /** Safe subset of response data (e.g. bot username, webhook URL presence). */
  data?: Record<string, unknown>;
}

/** Injectable interface for Telegram Bot API operations. */
export interface TelegramOps {
  getMe(): Promise<TelegramCommandResult>;
  setWebhook(webhookUrl: string, secretToken?: string): Promise<TelegramCommandResult>;
  getWebhookInfo(): Promise<TelegramCommandResult>;
  /**
   * Phase 18D — remove the bot's webhook. Used to AUTO-REVERT a webhook that 18D set when a
   * later step in the runtime pipeline fails (a stolen webhook pointed at a half-deployed
   * worker is actively harmful). Safe + reversible; never logs the token.
   */
  deleteWebhook(): Promise<TelegramCommandResult>;
  sendMessage(chatId: string, text: string): Promise<TelegramCommandResult>;
}

// ─── Output sanitisation ──────────────────────────────────────────────────────

function sanitize(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/bot[A-Za-z0-9_-]{20,}/gi, "bot[REDACTED]")
    .slice(0, 200);
}

// ─── Real implementation factory ──────────────────────────────────────────────

/**
 * Create a real TelegramOps implementation for a given bot token.
 * The token is captured in closure — never returned, logged, or included in messages.
 * The API URL contains the token and must never appear in any output.
 */
export function defaultTelegramOpsFactory(
  token: string,
  fetchImpl: typeof fetch = fetch
): TelegramOps {
  // NEVER log this URL — it contains the bot token.
  const api = (method: string): string =>
    `https://api.telegram.org/bot${token}/${method}`;

  return {
    async getMe(): Promise<TelegramCommandResult> {
      try {
        const res = await fetchImpl(api("getMe"), { method: "GET" });
        if (res.ok) {
          const body = (await res.json()) as {
            ok: boolean;
            result?: { username?: string; first_name?: string; id?: number };
          };
          if (body.ok && body.result) {
            const username = body.result.username ?? "unknown";
            return {
              success: true,
              message: `Bot verified: @${username}`,
              data: { username, botId: body.result.id },
            };
          }
        }
        return {
          success: false,
          message: `getMe failed: HTTP ${res.status}`,
        };
      } catch (err) {
        return {
          success: false,
          message: sanitize(
            `getMe network error: ${err instanceof Error ? err.message : "unknown"}`
          ),
        };
      }
    },

    async setWebhook(
      webhookUrl: string,
      secretToken?: string
    ): Promise<TelegramCommandResult> {
      const body: Record<string, string> = { url: webhookUrl };
      if (secretToken) body["secret_token"] = secretToken;

      try {
        const res = await fetchImpl(api("setWebhook"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; description?: string };
          if (data.ok) {
            return {
              success: true,
              message: "Webhook registered successfully",
              data: { secretProvided: !!secretToken },
            };
          }
          return {
            success: false,
            message: `setWebhook API error: ${sanitize(data.description ?? "unknown")}`,
          };
        }
        return {
          success: false,
          message: `setWebhook failed: HTTP ${res.status}`,
        };
      } catch (err) {
        return {
          success: false,
          message: sanitize(
            `setWebhook network error: ${err instanceof Error ? err.message : "unknown"}`
          ),
        };
      }
    },

    async getWebhookInfo(): Promise<TelegramCommandResult> {
      try {
        const res = await fetchImpl(api("getWebhookInfo"), { method: "GET" });
        if (res.ok) {
          const data = (await res.json()) as {
            ok: boolean;
            result?: {
              url?: string;
              has_custom_certificate?: boolean;
              pending_update_count?: number;
            };
          };
          if (data.ok && data.result !== undefined) {
            const currentUrl = data.result.url ?? "";
            return {
              success: true,
              message: currentUrl ? "Webhook is registered" : "No webhook configured",
              data: {
                hasWebhook: !!currentUrl,
                pendingUpdates: data.result.pending_update_count ?? 0,
                // Include URL for matching — never log it directly
                webhookUrl: currentUrl,
              },
            };
          }
        }
        return {
          success: false,
          message: `getWebhookInfo failed: HTTP ${res.status}`,
        };
      } catch (err) {
        return {
          success: false,
          message: sanitize(
            `getWebhookInfo error: ${err instanceof Error ? err.message : "unknown"}`
          ),
        };
      }
    },

    async deleteWebhook(): Promise<TelegramCommandResult> {
      try {
        const res = await fetchImpl(api("deleteWebhook"), { method: "POST" });
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; description?: string };
          if (data.ok) {
            return { success: true, message: "Webhook deleted" };
          }
          return {
            success: false,
            message: `deleteWebhook API error: ${sanitize(data.description ?? "unknown")}`,
          };
        }
        return { success: false, message: `deleteWebhook failed: HTTP ${res.status}` };
      } catch (err) {
        return {
          success: false,
          message: sanitize(
            `deleteWebhook error: ${err instanceof Error ? err.message : "unknown"}`
          ),
        };
      }
    },

    async sendMessage(chatId: string, text: string): Promise<TelegramCommandResult> {
      try {
        const res = await fetchImpl(api("sendMessage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        if (res.ok) {
          return { success: true, message: "Test message sent" };
        }
        return {
          success: false,
          message: `sendMessage failed: HTTP ${res.status}`,
        };
      } catch (err) {
        return {
          success: false,
          message: sanitize(
            `sendMessage error: ${err instanceof Error ? err.message : "unknown"}`
          ),
        };
      }
    },
  };
}

// ─── Mock factory for tests ───────────────────────────────────────────────────

/** Create a mock TelegramOps for tests. No real API calls are made. */
export function createMockTelegramOps(
  overrides: Partial<TelegramOps> = {}
): TelegramOps {
  return {
    getMe: async () => ({
      success: true,
      message: "Bot verified: @testbot",
      data: { username: "testbot", botId: 123456 },
    }),
    setWebhook: async () => ({
      success: true,
      message: "Webhook registered successfully",
      data: { secretProvided: true },
    }),
    getWebhookInfo: async () => ({
      success: true,
      message: "Webhook is registered",
      data: { hasWebhook: true, pendingUpdates: 0, webhookUrl: "https://example.com/webhook" },
    }),
    deleteWebhook: async () => ({
      success: true,
      message: "Webhook deleted",
    }),
    sendMessage: async () => ({
      success: true,
      message: "Test message sent",
    }),
    ...overrides,
  };
}
