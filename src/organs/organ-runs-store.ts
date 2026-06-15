/**
 * src/organs/organ-runs-store.ts — DB writer for organ run evidence (daemon-side).
 *
 * Thin layer over the existing cockpit DB handle (createCockpitProposalDb().query). Records one
 * organ run into the append-only organ_runs ledger and updates the agent_registry evidence columns
 * the deriver reads. Node-only (writes via service_role through HARTOS_SUPABASE_DB_URL).
 */
import type { OrganRunResult, OrganTrigger } from "./organ-contract.js";

/** Minimal shape of the daemon DB handle (createCockpitProposalDb). */
export interface OrganDb {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number | null; rows: unknown[] }>;
}

/** Record one organ run: insert an organ_runs row + update agent_registry evidence columns. */
export async function recordOrganRun(
  db: OrganDb,
  organId: string,
  trigger: OrganTrigger,
  disarmed: boolean,
  errored: boolean,
  res: OrganRunResult,
  durationMs: number,
): Promise<void> {
  await db.query(
    `insert into public.organ_runs (organ_id, trigger, ok, disarmed, errored, output_ref, summary, detail, duration_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      organId,
      trigger,
      res.ok,
      disarmed,
      errored,
      res.outputRef,
      res.summary.slice(0, 500),
      res.detail ? JSON.stringify(res.detail) : null,
      durationMs,
    ],
  );
  await db.query(
    `update public.agent_registry
       set last_run_at = now(),
           last_output_ref = $2,
           failure_state = case when $3 then null else $4::jsonb end,
           synced_at = now()
     where agent_id = $1`,
    [organId, res.outputRef, res.ok, res.ok ? null : JSON.stringify({ summary: res.summary.slice(0, 300) })],
  );
}
