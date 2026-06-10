/**
 * src/cockpit/pulse/pulse-run-spine.ts
 *
 * SHARED, PURE pulse-run-spine helpers. Zero I/O, zero secrets, no Node-only or browser-only deps,
 * so BOTH sides import it safely:
 *   • the Node writer (the autopilot, which inserts a row per pulse via the elevated pg URL), and
 *   • the hosted Worker reader (cloudflare-live-read-models.ts, via the anon read RPC).
 *
 * Mirrors cockpit-thread-spine.ts: the read RPC name, the row shape the RPC returns, the pure
 * row → render-summary mapping, and the pure pulse → write-row mapping the Node side persists.
 */

/** The single anon-callable, read-only RPC that exposes recent pulse runs. */
export const COCKPIT_PULSE_RUNS_RPC = "get_recent_pulse_runs";

/** The scalar columns the read RPC returns (snake_case, matching the SQL). */
export interface PulseRunRow {
  id: number;
  at: string;
  verdict: string | null;
  forecast_verdict: string | null;
  summary: string | null;
  finding_count: number;
  consequence_subjects: string[];
}

/** The render-ready pulse summary the hosted cockpit consumes. */
export interface PulseRun {
  id: number;
  at: string;
  verdict: string;
  forecastVerdict: string;
  summary: string;
  findingCount: number;
  consequenceSubjects: string[];
}

/** The fields the Node writer inserts: scalar columns + jsonb payload. */
export interface PulseRunWriteRow {
  at: string;
  verdict: string;
  forecast_verdict: string;
  summary: string;
  finding_count: number;
  consequence_subjects: string[];
  payload: Record<string, unknown>;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** Coerce the RPC's `unknown` JSON body into well-formed rows (skips junk). */
export function coercePulseRunRows(body: unknown): PulseRunRow[] {
  if (!Array.isArray(body)) return [];
  const rows: PulseRunRow[] = [];
  for (const r of body) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    rows.push({
      id: num(o.id),
      at: typeof o.at === "string" ? o.at : "",
      verdict: typeof o.verdict === "string" ? o.verdict : null,
      forecast_verdict: typeof o.forecast_verdict === "string" ? o.forecast_verdict : null,
      summary: typeof o.summary === "string" ? o.summary : null,
      finding_count: num(o.finding_count),
      consequence_subjects: strArray(o.consequence_subjects),
    });
  }
  return rows;
}

/** Map one RPC row to the render summary the cockpit shows (honest, non-fabricated defaults). */
export function mapRowToPulseRun(row: PulseRunRow): PulseRun {
  return {
    id: row.id,
    at: row.at,
    verdict: row.verdict ?? "unknown",
    forecastVerdict: row.forecast_verdict ?? "unknown",
    summary: row.summary ?? "",
    findingCount: row.finding_count,
    consequenceSubjects: row.consequence_subjects,
  };
}

/** Pure inputs → write-row mapping the autopilot persists for one pulse. */
export function buildPulseRunRow(input: {
  at: string;
  verdict: string;
  forecastVerdict: string;
  summary: string;
  findingCount: number;
  consequenceSubjects: string[];
  payload?: Record<string, unknown>;
}): PulseRunWriteRow {
  return {
    at: input.at,
    verdict: input.verdict,
    forecast_verdict: input.forecastVerdict,
    summary: input.summary,
    finding_count: input.findingCount,
    consequence_subjects: input.consequenceSubjects,
    payload: input.payload ?? {},
  };
}
