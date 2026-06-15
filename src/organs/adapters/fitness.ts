/**
 * src/organs/adapters/fitness.ts — the Fitness organ adapter.
 *
 * Fitness is an external-webhook agent (its draft pipeline lives in the separate
 * hart-os-fitness-trigger repo/worker). HartOS does NOT execute it here; the only
 * thing this adapter does is a READ-ONLY recency probe of the cockpit spine —
 * "when did the fitness agent last act?" — and reports it as honest evidence.
 *
 * Doctrine: status is DERIVED from evidence; never fake ok:true. With no spine DB
 * configured (HARTOS_SUPABASE_DB_URL absent) the handle is null and we return an
 * honest ok:false. ok=true requires an actual agent_actions row to read back.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { createCockpitProposalDb } from "../../cockpit/proposals/supabase-proposal-db.js";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

export const fitnessOrgan: OrganAdapter = {
  organId: "fitness",
  armingFlag: "HARTOS_FITNESS_POLL",
  async run(env: NodeJS.ProcessEnv, _now: string): Promise<OrganRunResult> {
    const handle = createCockpitProposalDb(env);
    if (!handle) {
      return { ok: false, outputRef: null, summary: "no spine DB configured" };
    }
    try {
      // Scope to fitness actions only (action_type like 'fitness%'); an unfiltered "latest by ANY
      // agent" query would mislabel a non-fitness action as the fitness recency signal.
      const r = await handle.query(
        "select id, created_at, action_type from public.agent_actions where action_type like 'fitness%' order by created_at desc limit 1",
      );
      const row = (r.rows[0] ?? null) as { id?: unknown; created_at?: unknown; action_type?: unknown } | null;
      if (!row || row.id === undefined || row.id === null) {
        return { ok: false, outputRef: null, summary: "no fitness actions in spine" };
      }
      const id = String(row.id);
      const createdAt = String(row.created_at);
      const actionType = String(row.action_type);
      return {
        ok: true,
        outputRef: id,
        summary: cap(`latest fitness action ${id} [${actionType}] @ ${createdAt}`),
        detail: { id, created_at: createdAt, action_type: actionType },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`fitness recency read failed: ${msg}`) };
    } finally {
      await handle.close();
    }
  },
};
