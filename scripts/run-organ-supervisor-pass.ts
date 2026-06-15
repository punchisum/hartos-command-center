/**
 * scripts/run-organ-supervisor-pass.ts — the SP-Organs supervisor pass (daemon sub-pass).
 *
 * Runs every registered organ once via runOrgan(): each under its OWN arming gate (a disarmed organ
 * writes an honest skip beat, never a fake run, never re-enqueues — same terminal invariant as the
 * job-runner fix 0e14660). Each run records an organ_runs evidence row + updates the agent_registry
 * last_run_at/last_output_ref the cockpit deriver reads. No organ gains new authority here.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/run-organ-supervisor-pass.js
 */
import { pathToFileURL } from "node:url";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { runOrgan, type OrganAdapter } from "../src/organs/organ-supervisor.js";
import { redact } from "../src/llm/redaction.js";
import { cockpitOrgan } from "../src/organs/adapters/cockpit.js";
import { fitnessOrgan } from "../src/organs/adapters/fitness.js";
import { opsOrgan } from "../src/organs/adapters/ops.js";
import { sentinelOrgan } from "../src/organs/adapters/sentinel.js";
import { prophetOrgan } from "../src/organs/adapters/prophet.js";
import { rinneganOrgan } from "../src/organs/adapters/rinnegan.js";
import { wolverineOrgan } from "../src/organs/adapters/wolverine.js";
import { beezulbubOrgan } from "../src/organs/adapters/beezulbub.js";
import { researchOrgan } from "../src/organs/adapters/research.js";
import { factoryOrgan } from "../src/organs/adapters/factory.js";
import { councilOrgan } from "../src/organs/adapters/council.js";

/** The registered organ fleet — one adapter per agent_registry row (seed: scripts/seed-organ-registry.ts). */
export const ALL_ORGANS: OrganAdapter[] = [
  cockpitOrgan, fitnessOrgan, opsOrgan, sentinelOrgan, prophetOrgan, rinneganOrgan,
  wolverineOrgan, beezulbubOrgan, researchOrgan, factoryOrgan, councilOrgan,
];

/** Run every organ once under its gate; record evidence. Error-isolated per organ. */
export async function runOrganSupervisorPass(env: NodeJS.ProcessEnv = process.env, now: string): Promise<string[]> {
  const h = createCockpitProposalDb(env);
  if (!h) return ["organ-supervisor: no spine DB (HARTOS_SUPABASE_DB_URL) — skipped"];
  const out: string[] = [];
  const perfNow = () => Date.now();
  try {
    for (const organ of ALL_ORGANS) {
      try {
        const res = await runOrgan(h, organ, env, now, perfNow);
        out.push(`${organ.organId}: ${res.ok ? "ok" : "skip/fail"} — ${res.summary}`);
      } catch (e) {
        out.push(`${organ.organId}: ERROR ${redact(e instanceof Error ? e.message : String(e))}`);
      }
    }
  } finally {
    await h.close();
  }
  return out;
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runOrganSupervisorPass(process.env, new Date().toISOString())
    .then((lines) => {
      console.log("\nHartOS — organ supervisor pass (each organ under its own gate)\n");
      for (const l of lines) console.log(`  • ${l}`);
      console.log("");
    })
    .catch((e) => {
      console.error(`organ supervisor failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
