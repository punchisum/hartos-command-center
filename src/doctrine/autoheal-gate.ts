/**
 * src/doctrine/autoheal-gate.ts — the GUARDRAILED-AUTONOMY gate (Wolverine's bounded hands).
 *
 * The daily pulse may auto-approve + auto-execute a fix WITHOUT a per-proposal human click ONLY
 * when its adapter belongs to an armed autoheal CLASS *and* its own per-action ALLOW_EXEC_* flag
 * is armed — a TRUE double gate, under the global kill-switch. Arming a class once is the human
 * floor ("I authorize autonomous repair for this class"); arming the per-adapter ALLOW_EXEC_*
 * stays the deliberate "I'm live" act. Both are OFF by default, so autonomy is opt-in, twice.
 *
 * By construction every autoheal class is INTERNAL + REVERSIBLE only (HartOS's own Supabase
 * queue). No external adapter (ClickUp / Telegram / deploy) is — or may ever be — an autoheal
 * class, so autonomous hands can never reach outside HartOS. Pure; no I/O.
 */

import { isActionAllowlisted, type ExecutionAdapter } from "../execution/execution-adapter.js";
import { rejectDraftsAdapter } from "../execution/adapters/reject-drafts.js";
import { archiveRejectedAdapter } from "../execution/adapters/archive-rejected.js";
import { refreshSyncAdapter } from "../execution/adapters/refresh-sync.js";
import type { MutationAdapterId } from "../execution/execution-dispatch.js";

export interface AutohealClass {
  id: string;
  /** The single class flag that authorizes autonomous APPROVAL for this class (default OFF). */
  flag: string;
  description: string;
  /** The adapters this class may auto-run. Each STILL needs its own ALLOW_EXEC_* armed too. */
  adapters: Array<{ id: MutationAdapterId; adapter: ExecutionAdapter }>;
}

/** The class flag for internal proposal-queue hygiene (the only autoheal class today). */
export const AUTOHEAL_PROPOSAL_HYGIENE_FLAG = "ALLOW_AUTOHEAL_PROPOSAL_HYGIENE";

export const AUTOHEAL_CLASSES: AutohealClass[] = [
  {
    id: "proposal-hygiene",
    flag: AUTOHEAL_PROPOSAL_HYGIENE_FLAG,
    description:
      "Auto-approve + execute internal, reversible proposal-queue hygiene (reject aging drafts, " +
      "archive rejected, expire stale) — HartOS's own Supabase only, zero external blast radius.",
    adapters: [
      { id: "reject-drafts", adapter: rejectDraftsAdapter },
      { id: "archive-rejected", adapter: archiveRejectedAdapter },
      { id: "refresh-sync", adapter: refreshSyncAdapter },
    ],
  },
];

function classArmed(env: Record<string, string | undefined>, flag: string): boolean {
  return (env[flag] ?? "").trim().toLowerCase() === "true";
}

/**
 * The set of adapter ids that may auto-execute RIGHT NOW: those in a class whose flag is armed
 * AND whose own ALLOW_EXEC_* is armed (`isActionAllowlisted` also enforces the kill-switch). The
 * empty set when nothing is fully armed — the safe default. Pure.
 */
export function armedAutohealAdapters(env: Record<string, string | undefined>): Set<MutationAdapterId> {
  const armed = new Set<MutationAdapterId>();
  for (const cls of AUTOHEAL_CLASSES) {
    if (!classArmed(env, cls.flag)) continue;
    for (const a of cls.adapters) {
      if (isActionAllowlisted(a.adapter, env)) armed.add(a.id);
    }
  }
  return armed;
}

/** The autoheal class an adapter belongs to (undefined — most adapters are never auto-healable). */
export function autohealClassFor(adapterId: MutationAdapterId): AutohealClass | undefined {
  return AUTOHEAL_CLASSES.find((c) => c.adapters.some((a) => a.id === adapterId));
}
