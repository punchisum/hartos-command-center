import { assertCallbackDataSafe } from "../lib/action-tokens.js";
import { emitDebugEvent } from "../lib/debug.js";
import { generatedCommandNames, isGeneratedCommand, type Env, type RuntimeDeps } from "../shared/types.js";
import { isAuthorizedTelegramUpdate, parseTelegramUpdate } from "./parser.js";

export interface RouteResult {
  status: "ok" | "rejected" | "queued" | "error";
  route: string;
  traceId: string;
}

export async function routeTelegramUpdate(
  input: unknown,
  env: Env,
  deps: RuntimeDeps
): Promise<RouteResult> {
  const update = parseTelegramUpdate(input);

  if (!isAuthorizedTelegramUpdate(update, env)) {
    await emitDebugEvent(env, deps.supabase, {
      traceId: update.traceId,
      runtime: "cloudflare",
      route: "telegram.auth",
      stage: "authorize",
      outcome: "skipped",
      failureCode: "unauthorized",
      metadata: { userId: update.userId, chatId: update.chatId },
    });
    return { status: "rejected", route: "unauthorized", traceId: update.traceId };
  }

  if (update.kind === "callback") {
    assertCallbackDataSafe(update.callbackData ?? "");
    await deps.trigger.enqueue("callback-token", { tok: update.token, traceId: update.traceId });
    return { status: "queued", route: "callback_token_validation", traceId: update.traceId };
  }

  if (update.command === "start" || update.command === "help") {
    await deps.sender.sendMessage(update.chatId, `Available commands: ${generatedCommandNames().map((name) => `/${name}`).join(", ")}`);
    return { status: "ok", route: "help", traceId: update.traceId };
  }

  if (update.command && isGeneratedCommand(update.command)) {
    await deps.supabase.insertCommandEvent({
      traceId: update.traceId,
      route: update.command,
      status: "queued",
      inputJson: { chatId: update.chatId, userId: update.userId },
    });
    await deps.trigger.enqueue(update.command, { update, traceId: update.traceId });
    return { status: "queued", route: update.command, traceId: update.traceId };
  }

  await deps.sender.sendMessage(update.chatId, "Unsupported command. Send /help.");
  return { status: "ok", route: "unsupported", traceId: update.traceId };
}
