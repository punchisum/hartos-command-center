/**
 * src/launch/observability-check.ts
 *
 * Check Supabase debug_events observability.
 * Read-only. Degrades safely when env is missing.
 * NEVER prints Supabase service role key.
 */

import type { ObservabilityResult } from "./types.js";

const DEFAULT_LOOKBACK_HOURS = 24;

/** Safe result — no secrets. */
function safeMsg(msg: string): string {
  return msg.replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]").slice(0, 200);
}

/**
 * Check observability by reading recent debug_events from Supabase.
 * The fetch function is injected so tests can mock it without real API calls.
 */
export async function checkObservability(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch
): Promise<ObservabilityResult> {
  const supabaseUrl = env["SUPABASE_URL"];
  const serviceKey = env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!supabaseUrl || !serviceKey) {
    return {
      status: "missing_env",
      recentEvents: 0,
      errorRate: null,
      message: "Supabase not configured — debug_events check skipped",
      nextAction: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable observability checks",
    };
  }

  // Read-only: query debug_events for recent activity
  try {
    const cutoff = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    const url =
      `${supabaseUrl}/rest/v1/debug_events` +
      `?select=outcome,created_at&created_at=gte.${cutoff}&limit=200&order=created_at.desc`;

    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        // Key is used in header but NEVER logged
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
    });

    if (res.status === 404) {
      return {
        status: "degraded",
        recentEvents: 0,
        errorRate: null,
        message: "debug_events table not found — migrations may not be applied",
        nextAction: "Run migrations:apply to create debug_events table",
      };
    }

    if (!res.ok) {
      return {
        status: "error",
        recentEvents: 0,
        errorRate: null,
        message: safeMsg(`debug_events check failed: HTTP ${res.status}`),
        nextAction: "Check Supabase connection and table permissions",
      };
    }

    const events = (await res.json()) as Array<{ outcome?: string }>;
    const total = events.length;
    const errors = events.filter((e) => e.outcome === "error").length;
    const errorRate = total > 0 ? Math.round((errors / total) * 100) : 0;

    if (total === 0) {
      return {
        status: "ok",
        recentEvents: 0,
        errorRate: 0,
        message: `No debug events in the last ${DEFAULT_LOOKBACK_HOURS}h — agent may not be running`,
        nextAction: "Deploy and test the agent to generate debug events",
      };
    }

    return {
      status: errorRate > 20 ? "degraded" : "ok",
      recentEvents: total,
      errorRate,
      message:
        `${total} event(s) in last ${DEFAULT_LOOKBACK_HOURS}h. Error rate: ${errorRate}%`,
      nextAction:
        errorRate > 20
          ? "Review recent error events in Supabase debug_events table"
          : "Observability looks healthy",
    };
  } catch (err) {
    return {
      status: "error",
      recentEvents: 0,
      errorRate: null,
      message: safeMsg(
        `Observability check error: ${err instanceof Error ? err.message : "unknown"}`
      ),
      nextAction: "Check network connectivity to Supabase",
    };
  }
}
