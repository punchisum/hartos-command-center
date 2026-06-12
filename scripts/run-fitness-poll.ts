/**
 * scripts/run-fitness-poll.ts — P5: the fitness pending-mutations poll pass (host glue).
 *
 * Polls the fitness side's pending mutations (get_pending_mutations, same DB — Hart Personal Core)
 * and ingests each into the cockpit spine as a pending_approval fitness proposal. GATED: a pure
 * no-op unless HARTOS_FITNESS_POLL=on AND the fitness identity is configured (so it never polls a
 * not-yet-existing RPC). Enqueues only — the approval floor + the default-OFF HARTOS_ALLOW_FITNESS_ADJUST
 * flag + the gated executor still decide every write. NODE EXECUTION HOST ONLY (pg). Never the Worker.
 */

import { pathToFileURL } from "node:url";
import { fitnessPollGate } from "../src/fitness/fitness-poll-gate.js";
import { pollAndIngestFitnessMutations } from "../src/fitness/fitness-poll-ingest.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { redact } from "../src/llm/redaction.js";

export async function runFitnessPollPass(env: Record<string, string | undefined>, now: Date): Promise<string[]> {
  const gate = fitnessPollGate(env);
  if (!gate.enabled || !gate.ctx) return [`fitness poll skipped: ${gate.reason}`];

  const handle = createCockpitProposalDb(env);
  if (!handle) return ["fitness poll skipped: proposal spine not configured (HARTOS_SUPABASE_DB_URL)"];

  try {
    const s = await pollAndIngestFitnessMutations(handle, gate.ctx, now);
    return [`fitness poll · polled ${s.polled} · ingested ${s.ingested} · skipped ${s.skipped}`];
  } finally {
    await handle.close();
  }
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runFitnessPollPass(process.env, new Date())
    .then((lines) => { for (const l of lines) console.log(l); })
    .catch((err) => { console.error(`fitness-poll failed: ${redact(err instanceof Error ? err.message : String(err))}`); process.exit(1); });
}
