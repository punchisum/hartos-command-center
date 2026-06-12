/**
 * src/telegram/run-approval-notify.ts — the live wiring for the outbound approval notifier.
 *
 * Reads the spine's `pending_approval` proposals and, when the notifier is armed (see
 * `telegramNotifyConfig`), pings Hart on Telegram with a deduped digest. Honest-skip when
 * disarmed or unconfigured — it returns `configured:false` with a reason and sends nothing, so
 * the daemon can call it every cycle at zero cost until Hart arms it with two env vars.
 *
 * NODE EXECUTION HOST ONLY — it reaches the Supabase spine (pg) and carries the Telegram token via
 * the injected sender; never import it into the read-only cockpit Worker bundle. The DB handle and
 * the sender are injectable so the path is unit-tested with fakes and no network.
 */

import { createCockpitProposalDb } from "../cockpit/proposals/supabase-proposal-db.js";
import { TelegramHttpSender } from "./sender.js";
import { getEnv } from "../runtime/env.js";
import type { TelegramSender } from "../shared/types.js";
import {
  telegramNotifyConfig,
  notifyPendingApprovals,
  type PendingProposalLite,
  type NotifyResult,
} from "./approval-notifier.js";

const PENDING_STATUS = "pending_approval";

/** Minimal DB handle shape the pass needs (the cockpit proposal db already satisfies it). */
interface DbHandle {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
  close(): Promise<void>;
}

export interface ApprovalNotifyDeps {
  /** Inject a DB handle (tests); default builds the live cockpit proposal db from env. */
  db?: DbHandle | null;
  /** Inject a sender (tests); default builds the live Telegram HTTP sender from env. */
  sender?: TelegramSender;
}

export interface ApprovalNotifyPassResult extends NotifyResult {
  /** False when disarmed/unconfigured (then `reason` says why and nothing was sent). */
  configured: boolean;
  reason?: string;
}

/** Map a raw spine row to the lite proposal shape (columns: id, title, risk_level, domain). */
function mapRow(row: unknown): PendingProposalLite {
  const r = row as { id: string; title?: string; risk_level?: string; domain?: string };
  return { id: String(r.id), title: r.title ?? r.id, riskLevel: r.risk_level, domain: r.domain };
}

/**
 * Run one approval-notify pass. Threads `notifiedIds` across calls (caller owns the Set) so a
 * still-pending proposal is announced once. Returns the updated set inside the result; the caller
 * adopts `result.notified`. Best-effort: a DB/sender error propagates to the caller to log — it
 * never advances any proposal state and holds no execution authority.
 */
export async function runApprovalNotifyPass(
  env: Record<string, string | undefined>,
  notifiedIds: ReadonlySet<string>,
  deps: ApprovalNotifyDeps = {},
): Promise<ApprovalNotifyPassResult> {
  const cfg = telegramNotifyConfig(env);
  if (!cfg.ok) return { configured: false, reason: cfg.reason, sent: false, count: 0, notified: new Set(notifiedIds) };

  const ownDb = deps.db === undefined;
  const handle = (deps.db ?? createCockpitProposalDb(env)) as DbHandle | null;
  if (!handle) {
    return { configured: false, reason: "proposal spine not configured (set HARTOS_SUPABASE_DB_URL)", sent: false, count: 0, notified: new Set(notifiedIds) };
  }
  try {
    const res = await handle.query(
      `select id, title, risk_level, domain from public.cockpit_proposals where status = $1 order by created_at desc nulls last limit 25`,
      [PENDING_STATUS],
    );
    const pending = res.rows.map(mapRow);
    // Prune the announced-set to what is STILL pending: keeps it bounded by the pending count and
    // gives correct re-announce semantics (a proposal that left pending and returns is announced again).
    const pendingIds = new Set(pending.map((p) => p.id));
    const prunedNotified = new Set([...notifiedIds].filter((id) => pendingIds.has(id)));
    const sender = deps.sender ?? new TelegramHttpSender(getEnv(env));
    const out = await notifyPendingApprovals({ sender, chatId: cfg.chatId!, pending, notifiedIds: prunedNotified });
    return { configured: true, ...out };
  } finally {
    if (ownDb) await handle.close();
  }
}
