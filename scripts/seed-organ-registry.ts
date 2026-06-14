/**
 * scripts/seed-organ-registry.ts — idempotent upsert of the 11 organ contracts into agent_registry.
 *
 * Writes each ORGAN_ROSTER row at lifecycle 'approved' (REGISTERED — present, not LIVE). The
 * DISPLAYED status is always derived from evidence (deriveOrganStatus); seeding never claims live.
 * Node-only (service_role via HARTOS_SUPABASE_DB_URL). Re-runnable: ON CONFLICT updates the contract.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/seed-organ-registry.js
 */
import { pathToFileURL } from "node:url";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { ORGAN_ROSTER } from "../src/organs/organ-roster.js";
import { redact } from "../src/llm/redaction.js";

export async function seedOrganRegistry(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const h = createCockpitProposalDb(env);
  if (!h) return ["no spine DB (HARTOS_SUPABASE_DB_URL) — skipped"];
  const out: string[] = [];
  try {
    for (const o of ORGAN_ROSTER) {
      await h.query(
        `insert into public.agent_registry
           (agent_id, display_name, capability_summary, parent_id, tier, lifecycle, permissions,
            arming_flag, known_risks, runtime_kind, heartbeat_source, can_write_external, detail_page,
            staleness_threshold_sec)
         values ($1,$2,$3,$4,$5,'approved',$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (agent_id) do update set
           display_name=excluded.display_name, capability_summary=excluded.capability_summary,
           parent_id=excluded.parent_id, tier=excluded.tier, permissions=excluded.permissions,
           arming_flag=excluded.arming_flag, known_risks=excluded.known_risks,
           runtime_kind=excluded.runtime_kind, heartbeat_source=excluded.heartbeat_source,
           can_write_external=excluded.can_write_external, detail_page=excluded.detail_page,
           staleness_threshold_sec=excluded.staleness_threshold_sec, synced_at=now()`,
        [
          o.agentId, o.displayName, o.capabilitySummary, o.parentId, o.tier,
          JSON.stringify({ propose: true, execute: o.canExecute }), o.armingFlag,
          JSON.stringify(o.knownRisks), o.runtimeKind, o.heartbeatSource, o.canWriteExternal,
          o.detailPage, o.stalenessThresholdSec,
        ],
      );
      out.push(`upserted ${o.agentId}`);
    }
  } finally {
    await h.close();
  }
  return out;
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  seedOrganRegistry()
    .then((l) => {
      for (const x of l) console.log(x);
      console.log(`\nseeded ${l.length} organ(s).`);
    })
    .catch((e) => {
      console.error(`seed failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
