/**
 * src/fitness/fitness-pending-poll.ts — P5: poll the fitness side's pending mutations.
 *
 * The command-center live-runner calls get_pending_mutations (fitness side, same DB — Hart Personal
 * Core) and maps each row to a PendingFitnessMutation that the ingest layer materialises into the
 * spine. Pins the read RPC contract the fitness-repo migration provides (consumer-driven). Rows with
 * an unrecognised recovery band are dropped — never materialise garbage. NODE-HOST ONLY (pg); never
 * the Worker.
 *
 * Contract: get_pending_mutations(p_user_id, p_agent_id, p_limit)
 *   → rows { state_date, recovery_band, recovery_score, action, calorie_pct, reason, idempotency_key }
 */

import type { PendingFitnessMutation } from "./fitness-mutation-materialize.js";
import type { FitnessContext } from "./fitness-mutation-db.js";

/** Minimal pg surface — matches the spine handle (rows: unknown[]); tests inject a fake. */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

const DEFAULT_LIMIT = 25;
const BANDS = new Set(["green", "amber", "red"]);

export interface PendingFitnessPoller {
  pollPending(limit?: number): Promise<PendingFitnessMutation[]>;
}

/** Map one RPC row to a PendingFitnessMutation, or null if the band is unrecognised. */
function mapRow(row: Record<string, unknown>): PendingFitnessMutation | null {
  const band = String(row.recovery_band ?? "");
  if (!BANDS.has(band)) return null;
  const score = row.recovery_score;
  return {
    stateDate: String(row.state_date ?? ""),
    recoveryBand: band as PendingFitnessMutation["recoveryBand"],
    recoveryScore: typeof score === "number" ? score : score == null ? null : Number(score),
    action: String(row.action ?? "") as PendingFitnessMutation["action"],
    caloriePct: Number(row.calorie_pct ?? 0),
    reason: String(row.reason ?? ""),
    idempotencyKey: String(row.idempotency_key ?? ""),
  };
}

export function makePendingFitnessPoller(db: Queryable, ctx: FitnessContext): PendingFitnessPoller {
  return {
    async pollPending(limit: number = DEFAULT_LIMIT): Promise<PendingFitnessMutation[]> {
      const r = await db.query(
        `select state_date, recovery_band, recovery_score, action, calorie_pct, reason, idempotency_key
         from public.get_pending_mutations($1, $2, $3)`,
        [ctx.userId, ctx.agentId, limit],
      );
      const out: PendingFitnessMutation[] = [];
      for (const row of r.rows) {
        const m = mapRow(row as Record<string, unknown>);
        if (m) out.push(m);
      }
      return out;
    },
  };
}
