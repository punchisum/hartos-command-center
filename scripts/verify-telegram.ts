import { getEnv } from "../src/runtime/env.js";
import { TelegramHttpSender } from "../src/telegram/sender.js";

const env = getEnv();
if (!env.TELEGRAM_BOT_TOKEN) {
  console.log("telegram: not configured");
  process.exit(0);
}

const sender = new TelegramHttpSender(env);
console.log(`telegram getMe: ${(await sender.getMe()) ? "ok" : "error"}`);
const sendResult = await sender.sendOptionalTestMessage("HartOS Telegram verification");
console.log(`telegram test send: ${sendResult}`);
