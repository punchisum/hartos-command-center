/**
 * src/fitness/fitness-poll-ingest.ts — P5: the cross-repo poller core (poll → ingest).
 *
 * The single core the command-center live-runner invokes each pass: poll the fitness side's pending
 * mutations (get_pending_mutations, same DB) and ingest each into the spine as a pending_approval
 * fitness proposal (idempotent by deterministic id). Over an injected Queryable; the pg pool + the
 * arming/config gate are the live-runner's thin glue. NODE-HOST ONLY; never the Worker.
 *
 * Nothing executes here — it only enqueues. The approval floor (Hart, or the armed autoheal class)
 * + the gated executor + the default-OFF HARTOS_ALLOW_FITNESS_ADJUST flag still decide every write.
 */

import { makePendingFitnessPoller, type Queryable } from "./fitness-pending-poll.js";
import { ingestPendingFitnessMutations, type FitnessIngestSummary } from "./fitness-mutation-ingest.js";
import type { FitnessContext } from "./fitness-mutation-db.js";

export interface FitnessPollIngestSummary extends FitnessIngestSummary {
  /** How many pending mutations the poll returned (before idempotent dedup). */
  polled: number;
}

export async function pollAndIngestFitnessMutations(
  db: Queryable,
  ctx: FitnessContext,
  now: Date,
  limit?: number,
): Promise<FitnessPollIngestSummary> {
  const pending = await makePendingFitnessPoller(db, ctx).pollPending(limit);
  const summary = await ingestPendingFitnessMutations(db, pending, now);
  return { ...summary, polled: pending.length };
}
