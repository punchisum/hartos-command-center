/**
 * src/telegram/run-failed-job-alert.ts — alert Hart when APPROVED work fails to execute.
 *
 * The worst blind spot the blueprint found: a Hart-approved agent job or proposal that fails
 * during execution is audited (cockpit_proposal_audit, event in failed | execution_failed |
 * autoheal_reverted) but NEVER surfaced — Hart is blind to it unless he reads the audit tail. This
 * pass reads the recent failure rows, joins the proposal for title/domain/risk, and pushes one
 * alert per NEW failure occurrence through the alert bus.
 *
 * Windowed (last FAILURE_WINDOW_MS) so a fresh daemon never floods on historical failures, and
 * deduped per immutable audit row (key includes the audit `at`) so a row is announced exactly once.
 * NODE host only (reaches the spine). Gated + honest-skip via the shared bus gate.
 */

import { createCockpitProposalDb } from "../cockpit/proposals/supabase-proposal-db.js";
import { TelegramHttpSender } from "./sender.js";
import { getEnv } from "../runtime/env.js";
import type { TelegramSender } from "../shared/types.js";
import { telegramNotifyConfig, sendAlerts, type Alert, type AlertBusState, type AlertSeverity } from "./alert-bus.js";

/** Only failures within this window are alert-worthy (bounds the startup set; > the poll cadence). */
export const FAILURE_WINDOW_MS = 15 * 60_000;

const FAILURE_EVENTS = ["failed", "execution_failed", "autoheal_reverted"];

const FAIL_SQL = `
  select a.proposal_id, a.event, a.at, p.title, p.domain, p.risk_level
  from public.cockpit_proposal_audit a
  left join public.cockpit_proposals p on p.id = a.proposal_id
  where a.event = any($1::text[]) and a.at > $2
  order by a.at desc
  limit 50`;

interface DbHandle {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
  close(): Promise<void>;
}

export interface FailedJobAlertResult {
  configured: boolean;
  reason?: string;
  sent: number;
  state: AlertBusState;
}

function toIso(at: unknown): string {
  if (at instanceof Date) return at.toISOString();
  const parsed = new Date(String(at ?? ""));
  return Number.isNaN(parsed.getTime()) ? String(at ?? "") : parsed.toISOString();
}

/** Map a failure audit row → a typed Alert (high; critical when a high-risk proposal failed). */
export function failureRowToAlert(row: unknown): Alert {
  const r = row as { proposal_id: string; event: string; at: unknown; title?: string; domain?: string; risk_level?: string };
  const atIso = toIso(r.at);
  const event = String(r.event);
  const reverted = event === "autoheal_reverted";
  const sev: AlertSeverity = reverted
    ? "medium"
    : String(r.risk_level ?? "").toLowerCase() === "high"
      ? "critical"
      : "high";
  const title = r.title && String(r.title).length > 0 ? String(r.title) : String(r.proposal_id);
  const dom = r.domain ? `${r.domain} · ` : "";
  const label = reverted ? "proposal auto-reverted (no-op)" : "execution FAILED";
  return {
    key: `jobfail:${r.proposal_id}:${event}:${atIso}`,
    severity: sev,
    title: `${label} — ${dom}${title}`,
    body: reverted
      ? `An approved proposal was reverted with no write.\nproposal ${r.proposal_id}\nevent ${event} at ${atIso}`
      : `Hart-approved work did not complete.\nproposal ${r.proposal_id}\nevent ${event} at ${atIso}`,
    source: "job runner",
  };
}

/**
 * Run one failed-job alert pass. Threads `state` (the bus dedup) across cycles. `now` is injected.
 * Honest-skip (configured:false) when disarmed/unconfigured. DB + sender are injectable for tests.
 */
export async function runFailedJobAlertPass(
  env: Record<string, string | undefined>,
  now: string,
  state: AlertBusState,
  deps: { db?: DbHandle | null; sender?: TelegramSender } = {},
): Promise<FailedJobAlertResult> {
  const cfg = telegramNotifyConfig(env, true);
  if (!cfg.ok) return { configured: false, reason: cfg.reason, sent: 0, state };

  const ownDb = deps.db === undefined;
  const handle = (deps.db ?? createCockpitProposalDb(env)) as DbHandle | null;
  if (!handle) return { configured: false, reason: "proposal spine not configured (set HARTOS_SUPABASE_DB_URL)", sent: 0, state };
  try {
    const nowMs = Date.parse(now);
    const sinceIso = new Date(nowMs - FAILURE_WINDOW_MS).toISOString();
    const res = await handle.query(FAIL_SQL, [FAILURE_EVENTS, sinceIso]);
    const alerts = res.rows.map(failureRowToAlert);
    const sender = deps.sender ?? new TelegramHttpSender(getEnv(env));
    const out = await sendAlerts({ sender, chatId: cfg.chatId!, alerts, state, nowMs });
    return { configured: true, sent: out.sent, state: out.nextState };
  } finally {
    if (ownDb) await handle.close();
  }
}
