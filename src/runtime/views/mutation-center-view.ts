/**
 * src/runtime/views/mutation-center-view.ts
 *
 * Phase 16 — a PURE read-only cockpit view-builder that surfaces the Mutation Center
 * (3-levels-up master plan §12) as a hosted-cockpit panel. It wraps the already-shipped
 * `buildMutationCenterModel` (src/cockpit/mutation/mutation-center.ts) and adds the same
 * `available` honesty branch the hosted views use (mirroring `proposalsView` in
 * src/runtime/cloudflare-cockpit-views.ts): when the snapshot carries no proposal queue,
 * the panel is honestly `available: false` rather than fabricating rows.
 *
 * This is a read/control-plane projection only. Like the model it wraps:
 *   - it imports nothing that deploys, mutates, persists, fetches, or executes,
 *   - it never reads the filesystem, network, Supabase/pg, or the ambient clock,
 *   - `executable` stays the literal `"disabled"` — never a button, never a boolean true.
 *
 * The live approval + the actual one-action mutation happen on the SEPARATE, gated live
 * surface. The hosted spine also clamps live statuses out of the Worker-resolved snapshot,
 * so an empty row set here means "nothing the cockpit can see is pending-executable" — NOT
 * "nothing has been approved". The empty-state note says so honestly.
 */

import type { CockpitState } from "../../cockpit/cockpit-types.js";
import {
  buildMutationCenterModel,
  type MutationCenterModel,
} from "../../cockpit/mutation/mutation-center.js";

/**
 * The hosted Mutation Center panel view. When `available`, it spreads the full
 * `MutationCenterModel` (origin/mode/executable/note/total/pending/rows). When not, it
 * mirrors `proposalsView`'s unavailable branch: an honest, read-only, zero-row shell.
 */
export type MutationCenterView =
  | ({ available: true } & MutationCenterModel)
  | {
      available: false;
      origin: "local";
      mode: "local_only";
      executable: "disabled";
      note: string;
      total: number;
      pending: number;
      rows: [];
    };

/**
 * PURE. Project the read-only Mutation Center panel from a cockpit snapshot.
 *
 * - When `state.proposalQueue` is present: returns `{ available: true, ...model }` from
 *   `buildMutationCenterModel`. The model already includes ONLY pending-executable rows
 *   (simulated_approved / approved_for_execution) and stamps `executable: "disabled"`.
 *   When the queue is present but resolves to zero pending-executable rows, the model's
 *   `note` is replaced with an honest empty-state note (the hosted spine clamps live
 *   statuses, so empty ≠ "nothing approved").
 * - When `state` / `state.proposalQueue` is absent: returns the honest `available: false`
 *   shell, mirroring `proposalsView`'s unavailable branch. No fabricated rows.
 *
 * No I/O, no fetch, no env, no clock — derives the view from the snapshot and nothing else.
 */
export function mutationCenterView(state: CockpitState | undefined): MutationCenterView {
  const queue = state?.proposalQueue;
  if (!queue) {
    return {
      available: false,
      origin: "local",
      mode: "local_only",
      executable: "disabled",
      note:
        "Mutation Center is unavailable — no proposal queue is embedded in this snapshot. " +
        "The queue is local-only in the hosted MVP; create/manage proposals from the local " +
        "cockpit (npm run cockpit:web), then re-bake the snapshot.",
      total: 0,
      pending: 0,
      rows: [],
    };
  }
  const model = buildMutationCenterModel(queue);
  if (model.pending === 0) {
    // Present, but no pending-executable rows. This is NOT "nothing approved": the hosted
    // spine clamps executor-only/live statuses out of the snapshot the Worker resolves, so
    // an approved-for-execution row may exist live yet not be visible here. Say so honestly
    // rather than implying the approval queue is empty.
    return {
      available: true,
      ...model,
      note:
        "Read-only Mutation Center projection of the local proposal queue. No rows are " +
        "pending-executable in this snapshot. This does NOT mean nothing is approved — the " +
        "hosted spine clamps live/executor statuses out of the snapshot, so approved actions " +
        "may exist on the separate gated live surface and simply not be visible here.",
    };
  }
  return { available: true, ...model };
}
