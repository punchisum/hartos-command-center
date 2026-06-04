import type { Env } from "../shared/types.js";

export interface NormalizedTelegramUpdate {
  traceId: string;
  kind: "command" | "callback" | "message";
  chatId: string;
  userId: string;
  text?: string;
  command?: string;
  callbackData?: string;
  token?: string;
}

function listFromEnv(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function parseTelegramUpdate(input: unknown): NormalizedTelegramUpdate {
  const update = input as {
    message?: { chat?: { id?: string | number }; from?: { id?: string | number }; text?: string };
    callback_query?: {
      id?: string;
      data?: string;
      message?: { chat?: { id?: string | number } };
      from?: { id?: string | number };
    };
  };

  const traceId = crypto.randomUUID();
  if (update.callback_query) {
    const callbackData = update.callback_query.data ?? "";
    const token = callbackData.startsWith("tok:") ? callbackData.slice(4) : undefined;
    return {
      traceId,
      kind: "callback",
      chatId: String(update.callback_query.message?.chat?.id ?? ""),
      userId: String(update.callback_query.from?.id ?? ""),
      callbackData,
      token,
    };
  }

  const text = update.message?.text ?? "";
  const command = text.startsWith("/") ? text.slice(1).split(/\s+/, 1)[0] : undefined;
  return {
    traceId,
    kind: command ? "command" : "message",
    chatId: String(update.message?.chat?.id ?? ""),
    userId: String(update.message?.from?.id ?? ""),
    text,
    command,
  };
}

export function isAuthorizedTelegramUpdate(update: NormalizedTelegramUpdate, env: Env): boolean {
  const allowedUsers = listFromEnv(env.TELEGRAM_ALLOWED_USER_IDS);
  const allowedChats = listFromEnv(env.TELEGRAM_ALLOWED_CHAT_IDS);
  const userAllowed = allowedUsers.size === 0 || allowedUsers.has(update.userId);
  const chatAllowed = allowedChats.size === 0 || allowedChats.has(update.chatId);
  return userAllowed && chatAllowed;
}
