import type { Env, RuntimeDeps } from "../shared/types.js";
import { routeTelegramUpdate } from "./router.js";
import { safeEqual } from "../lib/safe-equal.js";

/**
 * Webhook secret doctrine:
 *   - When TELEGRAM_WEBHOOK_SECRET is configured, the Telegram header must match
 *     (constant-time comparison) or the request is rejected.
 *   - In production the secret is REQUIRED: an unset secret fails closed instead
 *     of accepting unauthenticated posts.
 *   - Outside production an unset secret keeps the route open for local tests.
 */
export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  deps: RuntimeDeps
): Promise<Response> {
  const configured = env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (configured) {
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    if (!secret || !safeEqual(secret, configured)) {
      return new Response("unauthorized", { status: 401 });
    }
  } else if ((env.APP_ENV ?? "").toLowerCase() === "production") {
    return new Response("webhook secret not configured", { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const result = await routeTelegramUpdate(update, env, deps);
  return Response.json({ ok: result.status !== "error", route: result.route, traceId: result.traceId });
}
