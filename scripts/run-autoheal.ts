/**
 * scripts/run-autoheal.ts — GUARDRAILED AUTONOMY: auto-approve + execute the armed autoheal class.
 *
 * The host wrapper around runAutohealCore. It opens the elevated proposal DB + the INTERNAL stores
 * only (reject-drafts / archive-rejected / refresh-sync) — never a ClickUp/external store, so
 * autonomous hands are internal-by-construction — and runs the gated autoheal pass. Disarmed by
 * default (needs ALLOW_AUTOHEAL_* + the matching ALLOW_EXEC_*); a no-op otherwise. The autopilot
 * pulse calls runAutoheal each beat; it can also be run standalone.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/run-autoheal.js [--max 3]
 */

import { pathToFileURL } from "node:url";
import { dispatchMutation } from "../src/execution/execution-dispatch.js";
import { runAutohealCore } from "../src/execution/autoheal-executor.js";
import { armedAutohealAdapters } from "../src/doctrine/autoheal-gate.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { createRejectDraftsDb } from "../src/execution/run-reject-drafts-db.js";
import { createArchiveRejectedDb } from "../src/execution/run-archive-rejected-db.js";
import { createRefreshSyncDb } from "../src/execution/run-refresh-sync-db.js";
import { redact } from "../src/llm/redaction.js";

function parseMax(argv: string[]): number {
  const i = argv.indexOf("--max");
  if (i >= 0 && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 3;
}

export async function runAutoheal(
  env: Record<string, string | undefined>,
  now: Date,
  max = 3,
): Promise<string[]> {
  // Fast no-op when nothing is twice-armed — never even opens a DB connection.
  if (armedAutohealAdapters(env).size === 0) {
    return ["no autoheal class fully armed (ALLOW_AUTOHEAL_* + the matching ALLOW_EXEC_*) — nothing auto-executed"];
  }
  const handle = createCockpitProposalDb(env);
  if (!handle) {
    return ["proposal spine not configured (set HARTOS_SUPABASE_DB_URL) — nothing auto-executed"];
  }
  const rejectHandle = await createRejectDraftsDb(env);
  const archiveHandle = await createArchiveRejectedDb(env);
  const refreshHandle = await createRefreshSyncDb(env);
  try {
    const summary = await runAutohealCore({
      db: handle,
      stores: {
        ...(rejectHandle ? { rejectDrafts: rejectHandle.store } : {}),
        ...(archiveHandle ? { archiveRejected: archiveHandle.store } : {}),
        ...(refreshHandle ? { refreshSync: refreshHandle.store } : {}),
      },
      env,
      dispatch: dispatchMutation,
      now,
      max,
    });
    return summary.lines;
  } finally {
    if (rejectHandle) await rejectHandle.close();
    if (archiveHandle) await archiveHandle.close();
    if (refreshHandle) await refreshHandle.close();
    await handle.close();
  }
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runAutoheal(process.env, new Date(), parseMax(process.argv.slice(2)))
    .then((lines) => {
      console.log("\nHartOS — autoheal (guardrailed autonomy; twice-armed classes only)\n");
      for (const l of lines) console.log(l);
      console.log("");
    })
    .catch((err) => {
      console.error(`autoheal failed: ${redact(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
}
