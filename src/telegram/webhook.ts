import type { Env, RuntimeDeps } from "../shared/types.js";
import { routeTelegramUpdate } from "./router.js";

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  deps: RuntimeDeps
): Promise<Response> {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const update = await request.json();
  const result = await routeTelegramUpdate(update, env, deps);
  return Response.json({ ok: result.status !== "error", route: result.route, traceId: result.traceId });
}
