import type { Env, TelegramSender } from "../shared/types.js";
import { optionalEnv, requireEnv } from "../runtime/env.js";

export interface TelegramFetchOptions {
  fetchImpl?: typeof fetch;
}

export class TelegramHttpSender implements TelegramSender {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly env: Env, options: TelegramFetchOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const token = requireEnv(this.env, "TELEGRAM_BOT_TOKEN");
    const response = await this.fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!response.ok) throw new Error(`Telegram sendMessage failed: ${response.status}`);
  }

  async getMe(): Promise<boolean> {
    const token = requireEnv(this.env, "TELEGRAM_BOT_TOKEN");
    const response = await this.fetchImpl(`https://api.telegram.org/bot${token}/getMe`);
    return response.ok;
  }

  async sendOptionalTestMessage(text: string): Promise<"sent" | "skipped"> {
    if (this.env.ALLOW_TELEGRAM_TEST_SEND !== "true") return "skipped";
    const chatId = optionalEnv(this.env, "TEST_TELEGRAM_CHAT_ID") ?? optionalEnv(this.env, "DEBUG_CHANNEL_ID");
    if (!chatId) return "skipped";
    await this.sendMessage(chatId, text);
    return "sent";
  }
}
