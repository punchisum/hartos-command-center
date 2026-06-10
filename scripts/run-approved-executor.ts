/**
 * scripts/run-approved-executor.ts — "approve → it moves" host entrypoint (Phase 1).
 *
 * Reads the local proposal queue, picks the proposals Hart APPROVED (status
 * approved_for_execution), reconstructs each gated MutationCommand from the proposal payload, and
 * dispatches it through the ONE gated path (`dispatchMutation`). On a real write it advances the
 * proposal to `executed`. No per-card CLI args — the card/from/to come from the approved proposal.
 *
 * One pass = one card by default (`--max N` to raise). Adds NO authority: each adapter's
 * fail-closed gate + the per-action ALLOW_EXEC_* flag (default-OFF) + the kill-switch still decide.
 * An un-armed flag yields an honest "no_write" and the proposal is left approved (re-runnable;
 * the move is idempotent). NODE EXECUTION HOST ONLY — never imported by the read-only Worker; the
 * secret is read from env and NEVER printed.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/run-approved-executor.js [--max 1]
 */

import { pathToFileURL } from "node:url";
import { listProposals, markExecuted } from "../src/cockpit/proposals/proposal-queue.js";
import { executeApprovedProposals } from "../src/execution/approved-executor.js";
import { dispatchMutation } from "../src/execution/execution-dispatch.js";
import { createClickUpClient, CLICKUP_TOKEN_ENV } from "../src/execution/clickup-client.js";
import { createRejectDraftsDb } from "../src/execution/run-reject-drafts-db.js";
import { createArchiveRejectedDb } from "../src/execution/run-archive-rejected-db.js";
import { EXECUTABLE_FROM } from "../src/doctrine/execution-gate.js";

function parseMax(argv: string[]): number {
  const i = argv.indexOf("--max");
  if (i >= 0 && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 1;
}

export async function runApprovedExecutor(opts: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
  max?: number;
}): Promise<string[]> {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const out: string[] = [];

  const all = await listProposals(cwd);
  const approved = all.filter((p) => p.status === EXECUTABLE_FROM);
  if (approved.length === 0) {
    out.push(`No approved proposals (status ${EXECUTABLE_FROM}) in the queue — nothing to execute.`);
    return out;
  }

  const clickUp = createClickUpClient(env);
  if (!clickUp) out.push(`ClickUp not configured (set ${CLICKUP_TOKEN_ENV}); ClickUp moves/comments will skip.`);
  // Internal-cleanup stores (pg). Null when HARTOS_SUPABASE_DB_URL is absent → those adapters skip.
  const rejectHandle = await createRejectDraftsDb(env);
  const archiveHandle = await createArchiveRejectedDb(env);

  try {
    const summary = await executeApprovedProposals({
      proposals: approved,
      stores: {
        ...(clickUp ? { clickUpMove: clickUp.moveStore, clickUpComment: clickUp.commentStore } : {}),
        ...(rejectHandle ? { rejectDrafts: rejectHandle.store } : {}),
        ...(archiveHandle ? { archiveRejected: archiveHandle.store } : {}),
      },
      env,
      dispatch: dispatchMutation,
      now,
      max: opts.max ?? 1,
    });

    out.push(`Approved: ${summary.executable} · executed (wrote): ${summary.executed}`);
    for (const r of summary.results) {
      out.push(`  • ${r.proposalId} [${r.adapterId ?? "—"}] → ${r.outcome}: ${r.detail}`);
      if (r.wrote) {
        await markExecuted(cwd, { id: r.proposalId }, now.toISOString(), `dispatched ${r.adapterId}`);
        out.push(`    proposal advanced → executed`);
      }
    }
    return out;
  } finally {
    if (rejectHandle) await rejectHandle.close();
    if (archiveHandle) await archiveHandle.close();
  }
}

const isMain =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runApprovedExecutor({ max: parseMax(process.argv.slice(2)) })
    .then((lines) => {
      console.log("\nHartOS — approved-proposal executor (gated; flags decide)\n");
      for (const l of lines) console.log(l);
      console.log("");
    })
    .catch((err) => {
      console.error(`executor failed: ${(err as Error).message}`);
      process.exit(1);
    });
}
