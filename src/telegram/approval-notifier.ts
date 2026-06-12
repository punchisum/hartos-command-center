/**
 * src/telegram/approval-notifier.ts — HartOS → Hart outbound approval notifications.
 *
 * This is the action-surface increment that closes the human-in-the-loop OFF the cockpit: when a
 * proposal is sitting in `pending_approval`, the daemon pings Hart on Telegram so he does not have
 * to watch the cockpit to know HartOS needs him. It is OUTBOUND-ONLY (HartOS notifying its own
 * operator) — never a world-mutation — so it carries no execution authority; the approval floor is
 * unchanged (Hart still approves in the cockpit; this only tells him there is something to approve).
 *
 * Gated default-OFF: it sends NOTHING unless `ALLOW_TELEGRAM_NOTIFY=true` AND `TELEGRAM_BOT_TOKEN`
 * AND `HARTOS_TELEGRAM_NOTIFY_CHAT_ID` are all present. Deduped per proposal id (a Set the caller
 * threads across cycles) so a still-pending proposal is announced once, not every poll.
 *
 * Pure + injectable: the sender and the pending list are passed in, so the digest formatting and
 * the dedupe are unit-tested with a fake sender and no network. The DB read + the live HTTP sender
 * live in the thin companion `run-approval-notify.ts`.
 */

import type { TelegramSender } from "../shared/types.js";

/** The gate + credential env keys (all three required to arm; absent ⇒ honest skip). */
export const TELEGRAM_NOTIFY_FLAG = "ALLOW_TELEGRAM_NOTIFY";
export const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
export const TELEGRAM_NOTIFY_CHAT_ENV = "HARTOS_TELEGRAM_NOTIFY_CHAT_ID";

/** The minimal proposal shape the digest needs — the columns the spine already carries. */
export interface PendingProposalLite {
  id: string;
  title: string;
  riskLevel?: string;
  domain?: string;
}

/** Whether the outbound notifier is armed, and the resolved chat id. Never throws; never logs secrets. */
export interface NotifyConfig {
  ok: boolean;
  chatId?: string;
  reason?: string;
}

/** Resolve the notifier config from env — fail-closed: any missing piece ⇒ `ok:false` with a reason. */
export function telegramNotifyConfig(env: Record<string, string | undefined>): NotifyConfig {
  if (env[TELEGRAM_NOTIFY_FLAG] !== "true") return { ok: false, reason: `disarmed (${TELEGRAM_NOTIFY_FLAG} != true)` };
  if (!env[TELEGRAM_BOT_TOKEN_ENV] || env[TELEGRAM_BOT_TOKEN_ENV]!.trim().length === 0) return { ok: false, reason: `missing ${TELEGRAM_BOT_TOKEN_ENV}` };
  const chatId = env[TELEGRAM_NOTIFY_CHAT_ENV];
  if (!chatId || chatId.trim().length === 0) return { ok: false, reason: `missing ${TELEGRAM_NOTIFY_CHAT_ENV}` };
  return { ok: true, chatId: chatId.trim() };
}

/** A small risk glyph so the digest reads at a glance (high → red, medium → amber, else green). */
export function riskGlyph(risk?: string): string {
  const r = (risk ?? "").toLowerCase();
  if (r === "high" || r === "critical") return "🔴";
  if (r === "medium" || r === "elevated") return "🟡";
  return "🟢";
}

/** Proposals not yet announced in this run (deduped by id against the threaded Set). */
export function selectUnnotified(pending: PendingProposalLite[], notifiedIds: ReadonlySet<string>): PendingProposalLite[] {
  return pending.filter((p) => !notifiedIds.has(p.id));
}

/**
 * Format the approval digest. One concise message naming up to 8 proposals (glyph · domain · title)
 * plus a count overflow line, ending with where to act. Plain text (Telegram default parse mode).
 */
export function formatApprovalDigest(pending: PendingProposalLite[]): string {
  const head = pending.length === 1
    ? "🔔 HartOS · 1 proposal awaiting your approval"
    : `🔔 HartOS · ${pending.length} proposals awaiting your approval`;
  const shown = pending.slice(0, 8);
  const lines = shown.map((p) => {
    const dom = p.domain ? `${p.domain} · ` : "";
    return `${riskGlyph(p.riskLevel)} ${dom}${p.title}`;
  });
  const overflow = pending.length > shown.length ? [`…and ${pending.length - shown.length} more`] : [];
  return [head, "", ...lines, ...overflow, "", "Approve or reject in the cockpit → Synapses."].join("\n");
}

export interface NotifyResult {
  /** True iff a message was actually sent this pass. */
  sent: boolean;
  /** How many fresh (previously-unannounced) proposals were in the sent digest. */
  count: number;
  /** The updated notified-id set (a new Set; the input is never mutated). */
  notified: Set<string>;
}

/**
 * Send ONE digest for the fresh (unannounced) pending proposals, then mark them notified. A no-op
 * (sent:false) when there is nothing fresh. The sender is injected (live HTTP sender in prod, a fake
 * in tests). Never mutates the input Set — returns a new one so the caller can adopt it atomically.
 */
export async function notifyPendingApprovals(args: {
  sender: TelegramSender;
  chatId: string;
  pending: PendingProposalLite[];
  notifiedIds: ReadonlySet<string>;
}): Promise<NotifyResult> {
  const fresh = selectUnnotified(args.pending, args.notifiedIds);
  const notified = new Set(args.notifiedIds);
  if (fresh.length === 0) return { sent: false, count: 0, notified };
  await args.sender.sendMessage(args.chatId, formatApprovalDigest(fresh));
  for (const p of fresh) notified.add(p.id);
  return { sent: true, count: fresh.length, notified };
}
