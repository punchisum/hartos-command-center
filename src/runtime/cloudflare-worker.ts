import { SupabaseHttpClient } from "../supabase/client.js";
import { TelegramHttpSender } from "../telegram/sender.js";
import { TriggerHttpEnqueue } from "../trigger/enqueue.js";
import { handleTelegramWebhook } from "../telegram/webhook.js";
import type { Env, RuntimeDeps } from "../shared/types.js";

function createDeps(env: Env): RuntimeDeps {
  return {
    sender: new TelegramHttpSender(env),
    trigger: new TriggerHttpEnqueue(env),
    supabase: new SupabaseHttpClient(env),
  };
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/telegram/webhook") {
    return handleTelegramWebhook(request, env, createDeps(env));
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }
  return new Response("not found", { status: 404 });
}
