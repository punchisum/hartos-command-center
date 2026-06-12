/**
 * src/telegram/alert-bus.ts — the HartOS → Hart Telegram ALERT BUS (pure core).
 *
 * Generalizes the approval notifier into a multi-category alert channel: every source (failed
 * jobs, agent-liveness transitions, Wolverine RED verdicts, the daemon dead-man's-switch, LLM
 * fallback) produces typed `Alert`s that flow through ONE fail-closed gate, ONE per-key dedup
 * (edge-trigger + severity cooldown — the anti-spam spine), and ONE send path over the injected
 * TelegramSender. Outbound-only: alerts carry NO execution authority; the approval floor is
 * unchanged. PURE: no I/O, no clock — `nowMs` is injected so dedup is unit-testable.
 *
 * The gate (`telegramNotifyConfig`) lives here and is re-exported from approval-notifier.ts for
 * back-compat; the approval digest is now just one consumer of this bus's send primitives.
 */

import type { TelegramSender } from "../shared/types.js";

// ── the single fail-closed gate (shared by approvals + every alert category) ──────────────────

export const TELEGRAM_NOTIFY_FLAG = "ALLOW_TELEGRAM_NOTIFY";
export const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
export const TELEGRAM_NOTIFY_CHAT_ENV = "HARTOS_TELEGRAM_NOTIFY_CHAT_ID";
/** Optional split channel for problem-alerts; falls back to the notify chat when unset. */
export const TELEGRAM_ALERTS_CHAT_ENV = "HARTOS_TELEGRAM_ALERTS_CHAT_ID";

export interface NotifyConfig {
  ok: boolean;
  chatId?: string;
  reason?: string;
}

/** Resolve the master gate + a chat id. `preferAlertsChat` picks the (optional) alerts channel first. */
export function telegramNotifyConfig(env: Record<string, string | undefined>, preferAlertsChat = false): NotifyConfig {
  if (env[TELEGRAM_NOTIFY_FLAG] !== "true") return { ok: false, reason: `disarmed (${TELEGRAM_NOTIFY_FLAG} != true)` };
  if (!env[TELEGRAM_BOT_TOKEN_ENV] || env[TELEGRAM_BOT_TOKEN_ENV]!.trim().length === 0) return { ok: false, reason: `missing ${TELEGRAM_BOT_TOKEN_ENV}` };
  const alerts = preferAlertsChat ? env[TELEGRAM_ALERTS_CHAT_ENV] : undefined;
  const chatId = (alerts && alerts.trim().length > 0 ? alerts : env[TELEGRAM_NOTIFY_CHAT_ENV]) ?? "";
  if (!chatId || chatId.trim().length === 0) return { ok: false, reason: `missing ${TELEGRAM_NOTIFY_CHAT_ENV}` };
  return { ok: true, chatId: chatId.trim() };
}

// ── alert types ───────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "high" | "medium" | "info";

export interface Alert {
  /** Stable dedup id, e.g. 'liveness:orchestrator:down' or 'jobfail:<proposal>:<event>:<at>'. */
  key: string;
  severity: AlertSeverity;
  /** Short subject phrase. */
  title: string;
  /** Detail body (facts only; never secrets — callers redact). */
  body: string;
  /** Human source label, e.g. 'Sentinel', 'Wolverine', 'job runner'. */
  source: string;
}

/** Threaded across cycles: last epoch-ms each key was sent. Pruned to bound memory. */
export interface AlertBusState {
  lastSentAt: Record<string, number>;
}

export const EMPTY_ALERT_STATE: AlertBusState = { lastSentAt: {} };

const SEV_GLYPH: Record<AlertSeverity, string> = { critical: "🚨", high: "🔴", medium: "🟡", info: "🟢" };
const SEV_LABEL: Record<AlertSeverity, string> = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", info: "INFO" };
const MINUTE = 60_000;

/** Per-severity re-alert cooldown (a still-true condition re-announces at most this often). */
export function cooldownMs(severity: AlertSeverity): number {
  switch (severity) {
    case "critical": return 30 * MINUTE;
    case "high": return 60 * MINUTE;
    case "medium": return 4 * 60 * MINUTE;
    case "info": return 24 * 60 * MINUTE;
  }
}

/** The longest cooldown — entries older than this can be pruned (they'd re-send anyway). */
const MAX_COOLDOWN_MS = 24 * 60 * MINUTE;

export function severityGlyph(severity: AlertSeverity): string {
  return SEV_GLYPH[severity];
}

/** Render one alert as a plain-text Telegram message (glyph subject for at-a-glance scanning). */
export function formatAlert(a: Alert): string {
  return `${SEV_GLYPH[a.severity]} HartOS ${SEV_LABEL[a.severity]} — ${a.title}\n\n${a.body}\n\n(${a.source})`;
}

export interface DedupeResult {
  toSend: Alert[];
  nextState: AlertBusState;
}

/**
 * Per-key edge-trigger + cooldown. An alert sends when its key is unseen OR the per-severity
 * cooldown has elapsed since it last sent. Worsening transitions are modeled as DISTINCT keys by
 * the callers (e.g. ':stale' vs ':down'), so a real change is a fresh key and always alerts.
 * Never mutates the input state; prunes entries older than the max cooldown to bound memory.
 */
export function dedupeAlerts(incoming: Alert[], state: AlertBusState, nowMs: number): DedupeResult {
  const lastSentAt: Record<string, number> = {};
  // Carry forward only still-relevant entries (prune stale ones to bound the map).
  for (const [k, ts] of Object.entries(state.lastSentAt)) {
    if (nowMs - ts < MAX_COOLDOWN_MS) lastSentAt[k] = ts;
  }
  const toSend: Alert[] = [];
  for (const a of incoming) {
    const last = lastSentAt[a.key];
    if (last === undefined || nowMs - last >= cooldownMs(a.severity)) {
      toSend.push(a);
      lastSentAt[a.key] = nowMs;
    }
  }
  return { toSend, nextState: { lastSentAt } };
}

export interface SendAlertsResult {
  sent: number;
  nextState: AlertBusState;
}

/**
 * Dedupe `alerts` against `state`, then send each survivor as its own Telegram message through the
 * injected sender. Returns the count sent + the next state to thread forward. Never mutates input;
 * a send error propagates to the caller (who logs it) — the bus holds no execution authority.
 */
export async function sendAlerts(args: {
  sender: TelegramSender;
  chatId: string;
  alerts: Alert[];
  state: AlertBusState;
  nowMs: number;
}): Promise<SendAlertsResult> {
  const { toSend, nextState } = dedupeAlerts(args.alerts, args.state, args.nowMs);
  for (const a of toSend) {
    await args.sender.sendMessage(args.chatId, formatAlert(a));
  }
  return { sent: toSend.length, nextState };
}
