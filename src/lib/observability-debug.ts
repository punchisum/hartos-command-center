/**
 * Observability / Debug Event Template
 *
 * Every serious workflow must emit a debug_event with:
 *   trace_id, runtime, route, stage, outcome, failure_code, metadata
 *
 * Rules:
 *   - No secrets, no raw tokens, no raw Authorization headers in metadata.
 *   - Debug emission must NEVER throw — it must not break the workflow.
 *   - Telegram debug channel is throttled: not every event fires a message.
 */

export type DebugOutcome = "ok" | "degraded" | "error";
export type DebugRuntime = "cloudflare" | "trigger";

export interface DebugEvent {
  trace_id: string;
  runtime: DebugRuntime;
  route: string;
  stage: string;
  outcome: DebugOutcome;
  failure_code: string | null;
  metadata: Record<string, unknown>;
  created_at?: string;
}

/** Keys that must never appear in debug metadata. */
const FORBIDDEN_METADATA_KEYS = new Set([
  "authorization",
  "Authorization",
  "api_key",
  "apiKey",
  "token",
  "secret",
  "password",
  "credential",
  "service_role_key",
  "serviceRoleKey",
  "anon_key",
  "anonKey",
  "webhook_secret",
  "webhookSecret",
  "trigger_secret",
  "triggerSecret",
]);

/**
 * Strip forbidden keys and truncate long string values.
 * Long strings are likely raw tokens or request bodies.
 */
export function sanitizeMetadata(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      safe[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      safe[key] = value.slice(0, 100) + "...[truncated]";
      continue;
    }
    if (typeof value === "object" && value !== null) {
      safe[key] = sanitizeMetadata(value as Record<string, unknown>);
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

/** Build a safe, complete debug event ready for DB insert. */
export function buildDebugEvent(
  params: Omit<DebugEvent, "created_at"> & {
    metadata: Record<string, unknown>;
  }
): DebugEvent {
  return {
    ...params,
    failure_code: params.outcome !== "ok" ? (params.failure_code ?? "UNKNOWN") : null,
    metadata: sanitizeMetadata(params.metadata),
    created_at: new Date().toISOString(),
  };
}

/**
 * Emit a debug event to Supabase.
 * NEVER throws — failure to emit must not break the workflow.
 */
export async function emitDebugEvent(
  supabase: {
    from: (table: string) => {
      insert: (row: unknown) => Promise<{ error: unknown }>;
    };
  },
  event: DebugEvent
): Promise<void> {
  try {
    const { error } = await supabase.from("debug_events").insert(event);
    if (error) {
      console.error("[debug_events] insert failed:", error);
    }
  } catch (err) {
    console.error("[debug_events] unexpected error:", err);
  }
}

/**
 * Send a throttled debug message to the Telegram debug channel.
 * Only call this for errors or important milestones — not for every event.
 */
export async function notifyDebugChannel(params: {
  botToken: string;
  chatId: string;
  message: string;
  traceId: string;
}): Promise<void> {
  const text =
    `🔎 [${params.traceId.slice(0, 8)}]\n` + params.message.slice(0, 3000);

  try {
    await fetch(
      `https://api.telegram.org/bot${params.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: params.chatId,
          text,
          parse_mode: "Markdown",
        }),
      }
    );
  } catch (err) {
    console.error("[debug_channel] notify failed:", err);
  }
}

/** Generate a short trace ID for a workflow run. */
export function generateTraceId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * SQL for the debug_events table.
 * Copy this into a Supabase migration.
 *
 * create table if not exists public.debug_events (
 *   id uuid primary key default gen_random_uuid(),
 *   trace_id text not null,
 *   runtime text not null check (runtime in ('cloudflare', 'trigger')),
 *   route text not null,
 *   stage text not null,
 *   outcome text not null check (outcome in ('ok', 'degraded', 'error')),
 *   failure_code text,
 *   metadata jsonb not null default '{}'::jsonb,
 *   created_at timestamptz not null default now()
 * );
 * create index if not exists debug_events_trace_id_idx on public.debug_events (trace_id);
 * create index if not exists debug_events_created_at_idx on public.debug_events (created_at desc);
 */
