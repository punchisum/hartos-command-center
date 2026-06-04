import type { DebugEventInput, Env, SupabaseClient } from "../shared/types.js";

const REDACTED = "[REDACTED]";
const SECRET_KEY_PATTERN = /(authorization|api[_-]?key|token|secret|service[_-]?role|password)/i;
const SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})/g;

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_PATTERN, REDACTED);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    return sanitizeMetadata(value as Record<string, unknown>);
  }
  return value;
}

export function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(value);
  }
  return sanitized;
}

export async function emitDebugEvent(
  env: Env,
  supabase: SupabaseClient,
  event: DebugEventInput
): Promise<void> {
  if (env.ENABLE_DEBUG_EVENTS !== "true") return;

  try {
    await supabase.insertDebugEvent({
      ...event,
      metadata: sanitizeMetadata(event.metadata ?? {}),
    });
  } catch {
    // Debug logging must never break user-facing runtime flow.
  }
}
