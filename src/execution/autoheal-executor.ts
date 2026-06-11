/**
 * src/execution/autoheal-executor.ts — the GUARDRAILED-AUTONOMY executor core (testable).
 *
 * "Wolverine, with hands — bounded." Where the cockpit-approved spine executor (run-spine-executor)
 * waits for Hart's per-proposal Approve, this one auto-approves + executes the small set of fixes
 * whose autoheal CLASS is armed (see autoheal-gate.ts). It is the ONLY place HartOS approves its
 * own work, and it is fenced on every side:
 *
 *   1. armedAutohealAdapters() returns the adapters whose class flag AND per-adapter ALLOW_EXEC_*
 *      are BOTH armed (kill-switch enforced) — empty by default, so this is a no-op until twice-armed.
 *   2. only proposals routed to an armed, internal, reversible adapter are eligible.
 *   3. each eligible row is transitioned simulated_approved → approved_for_execution with a durable
 *      audit row (the real "second key", written here host-side), THEN run through the SAME gated
 *      dispatch the manual executor uses. A real write advances → executed (+ audit); a no-write
 *      REVERTS the row to simulated_approved (+ audit) so nothing is ever left stuck and the next
 *      pulse re-tries it. The execution gate (capability token + live read-before-write +
 *      ALLOW_EXEC_* + kill-switch) is unchanged and still decides every write.
 *
 * Pure core over an injected `db` (a Queryable) + injected stores + `dispatch` (the real
 * dispatchMutation in production, a fake in tests). NODE-HOST ONLY at the edges. Never the Worker.
 */

import { executeApprovedProposals, type ApprovedExecutorStores, type DispatchFn } from "./approved-executor.js";
import { armedAutohealAdapters } from "../doctrine/autoheal-gate.js";
import { EXECUTABLE_FROM } from "../doctrine/execution-gate.js";
import { ADAPTER_ROUTE_KEY } from "../cockpit/suggestions/suggestion-to-mutation.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import type { MutationAdapterId } from "./execution-dispatch.js";

/** The spine status the cockpit Approve sets (Hart's Key 1) and the row we auto-approve FROM. */
const COCKPIT_APPROVED_STATUS = "simulated_approved";
/** The authorized state we transition INTO (the documented second key, written host-side here). */
const AUTHORIZED_STATUS: string = EXECUTABLE_FROM; // "approved_for_execution"

/** Minimal pg surface — matches createCockpitProposalDb's handle; tests inject a fake. */
export interface AutohealDb {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export interface RunAutohealInput {
  db: AutohealDb;
  stores: ApprovedExecutorStores;
  env: Record<string, string | undefined>;
  dispatch: DispatchFn;
  /** Injected now (never the ambient clock). */
  now: Date;
  /** Cap how many real writes per pass (default 3 — a handful of internal fixes). */
  max?: number;
}

export interface AutohealSummary {
  armed: MutationAdapterId[];
  eligible: number;
  authorized: number;
  executed: number;
  reverted: number;
  lines: string[];
}

function asPayload(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/**
 * The adapter a spine row routes to. The `payload` column holds the full ProposalQueueItem, so the
 * route lives at `payload.proposedPayload[ADAPTER_ROUTE_KEY]` — the SAME place
 * commandFromApprovedProposal reads it (they must agree, or eligibility never matches reality).
 */
function adapterOf(payload: Record<string, unknown>): MutationAdapterId | null {
  const proposedPayload = asPayload(payload.proposedPayload);
  const route = proposedPayload[ADAPTER_ROUTE_KEY] as { adapterId?: MutationAdapterId } | undefined;
  return route?.adapterId ?? null;
}

/** Revert one authorized row back to simulated_approved (+ audit). Returns true iff it reverted. */
async function revert(db: AutohealDb, id: string): Promise<boolean> {
  const rev = await db.query(
    `update public.cockpit_proposals set status=$2, updated_at=now() where id=$1 and status=$3`,
    [id, COCKPIT_APPROVED_STATUS, AUTHORIZED_STATUS],
  );
  if ((rev.rowCount ?? 0) === 1) {
    await db.query(
      `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'autoheal_reverted', $2)`,
      [id, COCKPIT_APPROVED_STATUS],
    );
    return true;
  }
  return false;
}

/**
 * Run autoheal over the cockpit-approved spine. Reads `simulated_approved` rows, keeps only those
 * routed to a fully-armed autoheal adapter, transitions each to `approved_for_execution` (audited),
 * dispatches through the gated executor, then advances writes → executed and reverts no-writes.
 * Never throws on a single failure path; returns an honest summary.
 */
export async function runAutohealCore(input: RunAutohealInput): Promise<AutohealSummary> {
  const { db, env, now } = input;
  const max = input.max ?? 3;
  const armed = armedAutohealAdapters(env);
  if (armed.size === 0) {
    return {
      armed: [], eligible: 0, authorized: 0, executed: 0, reverted: 0,
      lines: ["no autoheal class fully armed (need ALLOW_AUTOHEAL_* + the matching ALLOW_EXEC_*) — nothing auto-executed"],
    };
  }
  const armedList = [...armed];

  const res = await db.query(
    `select id, payload from public.cockpit_proposals where status=$1 order by updated_at asc nulls last`,
    [COCKPIT_APPROVED_STATUS],
  );
  const rows = res.rows as Array<{ id: string; payload: unknown }>;
  const eligible = rows.filter((r) => {
    const a = adapterOf(asPayload(r.payload));
    return a !== null && armed.has(a);
  });
  if (eligible.length === 0) {
    return {
      armed: armedList, eligible: 0, authorized: 0, executed: 0, reverted: 0,
      lines: [`armed [${armedList.join(", ")}] · no matching approved proposals in the spine`],
    };
  }

  // Transition each eligible row → approved_for_execution (CAS so a concurrent run can't double-claim),
  // with a durable audit row, then reconstruct the in-memory item the executor consumes.
  const authorized: ProposalQueueItem[] = [];
  for (const r of eligible) {
    const upd = await db.query(
      `update public.cockpit_proposals set status=$2, updated_at=now() where id=$1 and status=$3`,
      [r.id, AUTHORIZED_STATUS, COCKPIT_APPROVED_STATUS],
    );
    if ((upd.rowCount ?? 0) !== 1) continue; // lost the race — another run claimed it
    await db.query(
      `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'autoheal_authorized', $2)`,
      [r.id, AUTHORIZED_STATUS],
    );
    const p = asPayload(r.payload) as unknown as ProposalQueueItem;
    authorized.push({ ...p, id: r.id, status: EXECUTABLE_FROM });
  }

  const summary = await executeApprovedProposals({
    proposals: authorized,
    stores: input.stores,
    env,
    dispatch: input.dispatch,
    now,
    max,
  });

  const lines: string[] = [`armed [${armedList.join(", ")}] · authorized ${authorized.length} · executed (wrote) ${summary.executed}`];
  let reverted = 0;
  const attempted = new Set<string>();
  for (const r of summary.results) {
    attempted.add(r.proposalId);
    lines.push(`  • ${r.proposalId} [${r.adapterId ?? "—"}] → ${r.outcome}: ${r.detail}`);
    if (r.wrote) {
      const adv = await db.query(
        `update public.cockpit_proposals set status='executed', updated_at=now() where id=$1 and status=$2`,
        [r.proposalId, AUTHORIZED_STATUS],
      );
      if ((adv.rowCount ?? 0) === 1) {
        await db.query(
          `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'executed', 'executed')`,
          [r.proposalId],
        );
        lines.push("    spine advanced → executed (+ durable audit row)");
      }
    } else if (await revert(db, r.proposalId)) {
      reverted += 1;
      lines.push("    no write — reverted → simulated_approved (re-tried next pulse)");
    }
  }
  // Anything authorized but never attempted (the max-writes cap stopped us) must not be left stuck.
  for (const p of authorized) {
    if (!attempted.has(p.id) && (await revert(db, p.id))) reverted += 1;
  }

  return { armed: armedList, eligible: eligible.length, authorized: authorized.length, executed: summary.executed, reverted, lines };
}
