import type { Env } from "../shared/types.js";
import { optionalEnv, requireEnv } from "../runtime/env.js";

export async function registerTelegramWebhook(env: Env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const token = requireEnv(env, "TELEGRAM_BOT_TOKEN");
  const webhookUrl = requireEnv(env, "TELEGRAM_WEBHOOK_URL");
  const secret = optionalEnv(env, "TELEGRAM_WEBHOOK_SECRET");

  const response = await fetchImpl(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      ...(secret ? { secret_token: secret } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram webhook registration failed: ${response.status}`);
  }
}
