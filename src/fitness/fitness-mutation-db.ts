/**
 * src/fitness/fitness-mutation-db.ts — P5: the live pg-backed fitness store (RPC contract).
 *
 * The fitness-mutation adapter's LIVE store. Fitness data lives in the SAME DB as the cockpit spine
 * (Hart Personal Core), so this reaches it through the elevated Node pg handle (HARTOS_SUPABASE_DB_URL)
 * and calls the fitness RPCs by name — pinning the contract the fitness-repo migration must satisfy
 * (consumer-driven, mirroring the other *-db.ts stores). NODE-HOST ONLY; pg never enters the Worker.
 *
 * Contract (the fitness migration provides these):
 *   • get_fitness_adjust_state(p_user_id, p_agent_id, p_state_date)
 *       → row { calorie_base int, applied_band text|null }  (no row ⇒ no state for the date)
 *   • apply_fitness_recovery_adjustment(p_user_id, p_agent_id, p_state_date, p_recovery_band,
 *       p_action, p_calorie_pct)  — ONE atomic RPC: applies the plan + calorie adjustment AND marks
 *       applied_band = p_recovery_band (so a re-run is a no-op; supersedes the two-RPC sketch with
 *       an atomic write). Service-role / elevated only.
 */

import type { FitnessMutationStore, FitnessDaySnapshot } from "../execution/adapters/fitness-mutation.js";

/** Minimal pg surface — lets tests inject a fake query without a live connection. */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

/** The fitness identity the RPCs are scoped to (baked in at store construction from env). */
export interface FitnessContext {
  userId: string;
  agentId: string;
}

/** Build the fitness-mutation store over any Queryable (the seam tests exercise). */
export function makeFitnessMutationStore(db: Queryable, ctx: FitnessContext): FitnessMutationStore {
  return {
    async getDay(stateDate: string): Promise<FitnessDaySnapshot | null> {
      const r = await db.query(
        `select calorie_base, applied_band from public.get_fitness_adjust_state($1, $2, $3)`,
        [ctx.userId, ctx.agentId, stateDate],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        stateDate,
        calorieBase: Number(row.calorie_base ?? 0),
        appliedBand: typeof row.applied_band === "string" ? row.applied_band : null,
      };
    },
    async applyAdjustment(input: { stateDate: string; band: string; action: string; caloriePct: number }): Promise<void> {
      // One atomic RPC: applies the adjustment AND stamps applied_band for idempotency.
      await db.query(
        `select public.apply_fitness_recovery_adjustment($1, $2, $3, $4, $5, $6)`,
        [ctx.userId, ctx.agentId, input.stateDate, input.band, input.action, input.caloriePct],
      );
    },
  };
}
