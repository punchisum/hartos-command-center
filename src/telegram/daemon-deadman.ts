/**
 * src/telegram/daemon-deadman.ts — the PURE read side of the dead-man's-switch.
 *
 * The Worker cron calls the `hartos_daemon_liveness_alert` RPC (which does the staleness check +
 * atomic alert-dedup in the DB) and feeds the result here. This module is pure: it parses the RPC
 * row and shapes the Telegram alert — no I/O, no clock. The RPC already deduped, so a returned
 * Alert should be sent as-is (no further bus dedup needed).
 */

import type { Alert } from "./alert-bus.js";

export interface DaemonLivenessResult {
  should_alert: boolean;
  kind: "down" | "recovery" | "none";
  status: string;
  seconds_silent: number;
  reason: string;
}

/** Parse the PostgREST RPC payload (an array of one row, or a bare object) into a typed result. */
export function parseDaemonRpcResult(raw: unknown): DaemonLivenessResult | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.should_alert !== "boolean") return null;
  const kind = r.kind === "down" || r.kind === "recovery" ? r.kind : "none";
  return {
    should_alert: r.should_alert,
    kind,
    status: String(r.status ?? "unknown"),
    seconds_silent: Number(r.seconds_silent ?? 0),
    reason: String(r.reason ?? ""),
  };
}

/** Shape the alert from an RPC result, or null when nothing should be sent. */
export function daemonAlert(r: DaemonLivenessResult): Alert | null {
  if (!r.should_alert) return null;
  if (r.kind === "recovery") {
    return {
      key: "daemon:live-runner:recovery",
      severity: "info",
      title: "HartOS live-runner back online",
      body: r.reason || "The execution daemon is heart-beating again.",
      source: "dead-man's-switch",
    };
  }
  const mins = Math.max(1, Math.round(r.seconds_silent / 60));
  return {
    key: "daemon:live-runner:down",
    severity: "critical",
    title: "HartOS live-runner is DOWN",
    body: `${r.reason}\nThe execution daemon stopped heart-beating (~${mins}m silent). Hart-approved jobs will NOT run until it is restarted.`,
    source: "dead-man's-switch",
  };
}
