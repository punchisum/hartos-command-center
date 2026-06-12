/**
 * scripts/run-rollback-executor.ts — execute Hart-APPROVED rollback proposals from the spine.
 *
 * The undo counterpart of run-spine-executor. A rollback proposal (rollback_pending_approval,
 * created by rollbackProposalFor) is approved by Hart to `rollback_approved` (Key 1). This Node
 * host (Key 2: capability token + the per-action ALLOW_EXEC_* flag) reads those, and for each:
 *   1. writes the rollback attempt audit (so the gate's audit floor holds by construction),
 *   2. confirms the ORIGINAL move was verified landed (a P3 execution_verification='landed' row),
 *   3. re-reads the live card, reconstructs the original command/outcome + gate facts,
 *   4. runs executeRollback — which derives the inverse + checks the fail-closed rollback-gate and,
 *      only if it passes, dispatches the inverse through the SAME gated dispatchMutation,
 *   5. advances the spine row → rollback_executed (real undo) or rollback_failed (refused/no write).
 *
 * Safe by construction: the per-action flag is default-OFF, the gate refuses an unconfirmed original
 * or a diverged target, and the inverse only inverts approved transitions. NODE EXECUTION HOST ONLY.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/run-rollback-executor.js [--max 1]
 */

import { pathToFileURL } from "node:url";
import { dispatchMutation } from "../src/execution/execution-dispatch.js";
import { executeRollback } from "../src/execution/rollback-executor.js";
import { rollbackInputForExecutedMove } from "../src/execution/rollback-request.js";
import { rollbackProposalFor } from "../src/execution/rollback-proposal.js";
import { recordExecutionVerification } from "../src/execution/execution-verification-audit.js";
import { isActionAllowlisted } from "../src/execution/execution-adapter.js";
import { clickupMoveStatusAdapter } from "../src/execution/adapters/clickup-move-status.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { createClickUpClient } from "../src/execution/clickup-client.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";
import { redact } from "../src/llm/redaction.js";

/** The spine status the cockpit sets when Hart approves a rollback (Key 1). */
const ROLLBACK_APPROVED = "rollback_approved";

function parseMax(argv: string[]): number {
  const i = argv.indexOf("--max");
  if (i >= 0 && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 1;
}

function parseFrom(argv: string[]): string | null {
  const i = argv.indexOf("--from");
  return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : null;
}

/**
 * `--from <executedId>` one-shot: generate a rollback for an executed move and AUTHORIZE it
 * host-side (insert as rollback_approved — running this CLI IS Hart's Key 1, exactly like
 * run-spine-executor). The main loop then executes it through the gated path (the ALLOW_EXEC_*
 * flag + fail-closed gate still decide every write). Returns a status line.
 */
async function createApprovedRollbackFrom(
  handle: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }> },
  executedId: string,
  now: Date,
): Promise<string> {
  const sel = await handle.query(`select id, payload, status from public.cockpit_proposals where id = $1 limit 1`, [executedId]);
  const row = (sel.rows as Array<{ id: string; payload: unknown; status: string }>)[0];
  if (!row) return `--from ${executedId}: no such proposal`;
  if (row.status !== "executed") return `--from ${executedId}: proposal status is "${row.status}", not "executed" — nothing landed to undo`;

  const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>;
  const original = { ...payload, id: row.id, status: "executed" } as unknown as ProposalQueueItem;
  const rb = rollbackProposalFor(original, now);
  if (!rb) return `--from ${executedId}: not an invertible executed move (no rollback generated)`;

  // Insert as rollback_approved (host authorization). ON CONFLICT keeps it idempotent — the
  // deterministic id means re-running --from never duplicates the rollback.
  const ins = await handle.query(
    `insert into public.cockpit_proposals (id, domain, action_type, title, risk_level, status, source_intent, created_at, updated_at, expires_at, payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$8,null,$9)
     on conflict (id) do nothing`,
    [rb.id, rb.domain, rb.actionType, rb.title, rb.riskLevel, ROLLBACK_APPROVED, rb.sourceIntent, now.toISOString(), JSON.stringify({ ...rb, status: ROLLBACK_APPROVED })],
  );
  await handle.query(
    `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'rollback_approved', $2)`,
    [rb.id, ROLLBACK_APPROVED],
  );
  return (ins.rowCount ?? 0) === 1
    ? `--from ${executedId}: created + authorized rollback ${rb.id}`
    : `--from ${executedId}: rollback ${rb.id} already exists (re-using it)`;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function runRollbackExecutor(
  env: Record<string, string | undefined>,
  now: Date,
  max: number,
  fromExecutedId: string | null = null,
): Promise<string[]> {
  const out: string[] = [];
  const handle = createCockpitProposalDb(env);
  if (!handle) {
    out.push("Proposal spine not configured (set HARTOS_SUPABASE_DB_URL) — nothing to roll back.");
    return out;
  }
  const clickUp = createClickUpClient(env);
  if (!clickUp) {
    out.push("ClickUp not configured (no CLICKUP_API_TOKEN) — cannot re-read or dispatch a move rollback.");
    await handle.close();
    return out;
  }

  try {
    // `--from <executedId>`: create + host-authorize the rollback first, then fall through to run it.
    if (fromExecutedId) out.push(await createApprovedRollbackFrom(handle, fromExecutedId, now));

    const res = await handle.query(
      `select id, payload, expires_at from public.cockpit_proposals where status = $1 order by updated_at asc nulls last`,
      [ROLLBACK_APPROVED],
    );
    const rows = res.rows as Array<{ id: string; payload: unknown; expires_at: string | null }>;
    if (rows.length === 0) {
      out.push(`No ${ROLLBACK_APPROVED} proposals in the spine — nothing to roll back.`);
      return out;
    }

    const hasToken = Boolean(env.CLICKUP_API_TOKEN);
    const allowlisted = isActionAllowlisted(clickupMoveStatusAdapter, env);
    let done = 0;

    for (const r of rows) {
      if (done >= max) break;
      const payload = (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>;
      const rollbackOf = str(payload, "rollbackOf");
      const cardId = str(payload, "cardId");
      const cardName = str(payload, "cardName");
      const fromStatus = str(payload, "fromStatus");
      const toStatus = str(payload, "toStatus");
      if (!rollbackOf || !cardId || !cardName || !fromStatus || !toStatus) {
        out.push(`  • ${r.id} → skipped: incomplete rollback payload`);
        continue;
      }

      // 1) Audit the attempt FIRST (the gate's audit floor holds by construction).
      await handle.query(
        `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'rollback_attempt', $2)`,
        [r.id, "rollback_executing"],
      );

      // 2) Confirm the ORIGINAL move was verified landed (a P3 execution_verification='landed' row).
      const conf = await handle.query(
        `select 1 from public.cockpit_proposal_audit where proposal_id = $1 and event = 'execution_verification' and to_status = 'landed' limit 1`,
        [rollbackOf],
      );
      const originalLandedConfirmed = (conf.rows?.length ?? 0) > 0;

      // 3) Fresh live re-read of the card (fail closed if it cannot be read).
      let liveStatus: string | null = null;
      try {
        const card = await clickUp.moveStore.getCard(cardId);
        liveStatus = card ? card.status : null;
      } catch {
        liveStatus = null;
      }

      const { originalCommand, originalOutcome, gate } = rollbackInputForExecutedMove({
        cardId, cardName, fromStatus, toStatus,
        proposalRef: { id: rollbackOf, status: "executed", expiresAt: null },
        store: clickUp.moveStore,
        liveStatus,
        originalLandedConfirmed,
        rollbackApproved: true,
        hasCapabilityToken: hasToken,
        actionAllowlisted: allowlisted,
        rollbackExpiresAt: r.expires_at,
      });

      // 4) Derive the inverse + check the fail-closed gate, then dispatch through the gated path.
      const result = await executeRollback({ originalCommand, originalOutcome, gate, env, dispatch: dispatchMutation, now });
      out.push(`  • ${r.id} [rollback of ${rollbackOf}] → ${result.outcome}: ${result.detail}`);

      // 5) Advance the spine row + durable audit. A real undo ⇒ rollback_executed; else rollback_failed.
      if (result.wrote) {
        const upd = await handle.query(
          `update public.cockpit_proposals set status='rollback_executed', updated_at=now() where id=$1 and status=$2`,
          [r.id, ROLLBACK_APPROVED],
        );
        if ((upd.rowCount ?? 0) === 1) {
          await handle.query(
            `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'rollback_executed', 'rollback_executed')`,
            [r.id],
          );
          await recordExecutionVerification(handle, r.id, result.verification ?? null);
          out.push("    spine advanced → rollback_executed (+ durable audit row)");
          done += 1;
        } else {
          out.push("    already advanced by a concurrent run — not re-audited");
        }
      } else {
        const upd = await handle.query(
          `update public.cockpit_proposals set status='rollback_failed', updated_at=now() where id=$1 and status=$2`,
          [r.id, ROLLBACK_APPROVED],
        );
        if ((upd.rowCount ?? 0) === 1) {
          await handle.query(
            `insert into public.cockpit_proposal_audit (proposal_id, event, to_status, detail) values ($1, 'rollback_failed', 'rollback_failed', $2)`,
            [r.id, result.detail],
          );
          out.push("    spine advanced → rollback_failed (refused / no write — see detail)");
        }
      }
    }
    return out;
  } finally {
    await handle.close();
  }
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runRollbackExecutor(process.env, new Date(), parseMax(process.argv.slice(2)), parseFrom(process.argv.slice(2)))
    .then((lines) => {
      console.log("\nHartOS — approved-rollback executor (gated; flags decide)\n");
      for (const l of lines) console.log(l);
      console.log("");
    })
    .catch((err) => {
      console.error(`rollback-executor failed: ${redact(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
}
