/**
 * scripts/run-spine-executor.ts — execute COCKPIT-APPROVED proposals from the Supabase spine.
 *
 * This is the bridge that turns a cockpit Approve into a real (gated) mutation. The cockpit's
 * Approve button transitions a spine proposal to `simulated_approved` (Hart's Key 1, audited).
 * This Node host (Key 2: capability token + the per-action ALLOW_EXEC_* flag) reads those
 * cockpit-approved proposals, runs each through the SAME gated dispatcher, and ONLY when a write
 * actually executes advances the spine row → `executed` and appends the durable audit row.
 *
 * Safe by construction: the per-action flag is default-OFF, so nothing mutates unless Hart armed
 * exactly the adapter he intends. An unarmed flag / missing capability yields an honest no_write
 * and the proposal stays cockpit-approved (re-runnable). NODE EXECUTION HOST ONLY.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/run-spine-executor.js [--max 1]
 */

import { pathToFileURL } from "node:url";
import { executeApprovedProposals } from "../src/execution/approved-executor.js";
import { recordExecutionVerification } from "../src/execution/execution-verification-audit.js";
import { dispatchMutation } from "../src/execution/execution-dispatch.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { createClickUpClient } from "../src/execution/clickup-client.js";
import { createRejectDraftsDb } from "../src/execution/run-reject-drafts-db.js";
import { createArchiveRejectedDb } from "../src/execution/run-archive-rejected-db.js";
import { createObsidianWriteStore } from "../src/execution/obsidian-write-store.js";
import { EXECUTABLE_FROM } from "../src/doctrine/execution-gate.js";
import { redact } from "../src/llm/redaction.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

/** The spine status the cockpit Approve button sets (Hart's Key 1). */
const COCKPIT_APPROVED_STATUS = "simulated_approved";

function parseMax(argv: string[]): number {
  const i = argv.indexOf("--max");
  if (i >= 0 && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 1;
}

export async function runSpineExecutor(
  env: Record<string, string | undefined>,
  now: Date,
  max: number,
): Promise<string[]> {
  const out: string[] = [];
  const handle = createCockpitProposalDb(env);
  if (!handle) {
    out.push("Proposal spine not configured (set HARTOS_SUPABASE_DB_URL) — nothing to execute.");
    return out;
  }
  const clickUp = createClickUpClient(env);
  const rejectHandle = await createRejectDraftsDb(env);
  const archiveHandle = await createArchiveRejectedDb(env);
  const obsidianStore = createObsidianWriteStore(env);

  try {
    const res = await handle.query(
      `select id, payload from public.cockpit_proposals where status = $1 order by updated_at asc nulls last`,
      [COCKPIT_APPROVED_STATUS],
    );
    const rows = res.rows as Array<{ id: string; payload: unknown }>;
    if (rows.length === 0) {
      out.push(`No cockpit-approved (${COCKPIT_APPROVED_STATUS}) proposals in the spine — nothing to execute.`);
      return out;
    }

    // Reconstruct from the spine payload; bump to approved_for_execution (cockpit Approve = Hart's
    // Key 1). The per-action ALLOW_EXEC_* flag (Key 2) still decides whether a write actually runs.
    const proposals: ProposalQueueItem[] = rows.map((r) => {
      const p = (r.payload && typeof r.payload === "object" ? r.payload : {}) as ProposalQueueItem;
      return { ...p, id: r.id, status: EXECUTABLE_FROM };
    });

    const summary = await executeApprovedProposals({
      proposals,
      stores: {
        ...(clickUp ? { clickUpMove: clickUp.moveStore, clickUpComment: clickUp.commentStore } : {}),
        ...(rejectHandle ? { rejectDrafts: rejectHandle.store } : {}),
        ...(archiveHandle ? { archiveRejected: archiveHandle.store } : {}),
        ...(obsidianStore ? { obsidianWrite: obsidianStore } : {}),
      },
      env,
      dispatch: dispatchMutation,
      now,
      max,
    });

    out.push(`Cockpit-approved: ${summary.executable} · executed (wrote): ${summary.executed}`);
    for (const r of summary.results) {
      out.push(`  • ${r.proposalId} [${r.adapterId ?? "—"}] → ${r.outcome}: ${r.detail}`);
      if (r.wrote) {
        // Idempotent advance: only the first claimant flips the row + writes the audit. A manual run
        // and the autopilot can race the same cockpit-approved rows; the status guard prevents a
        // double-advance + a duplicate audit row.
        const upd = await handle.query(
          `update public.cockpit_proposals set status='executed', updated_at=now() where id=$1 and status=$2`,
          [r.proposalId, COCKPIT_APPROVED_STATUS],
        );
        if ((upd.rowCount ?? 0) === 1) {
          await handle.query(
            `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'executed', 'executed')`,
            [r.proposalId],
          );
          // P3: persist whether the write actually LANDED (independent fresh re-read verdict).
          if (await recordExecutionVerification(handle, r.proposalId, r.verification)) {
            out.push(`    post-exec verify → ${r.verification!.landed ? "landed" : "UNVERIFIED"} (+ durable audit row)`);
          }
          out.push("    spine advanced → executed (+ durable audit row)");
        } else {
          out.push("    already advanced by a concurrent run — not re-audited");
        }
      }
    }
    return out;
  } finally {
    if (rejectHandle) await rejectHandle.close();
    if (archiveHandle) await archiveHandle.close();
    await handle.close();
  }
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runSpineExecutor(process.env, new Date(), parseMax(process.argv.slice(2)))
    .then((lines) => {
      console.log("\nHartOS — cockpit-approved spine executor (gated; flags decide)\n");
      for (const l of lines) console.log(l);
      console.log("");
    })
    .catch((err) => {
      console.error(`spine-executor failed: ${redact(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
}
