/**
 * src/organs/organ-supervisor.ts — the SP-Organs supervisor (the daemon's new responsibility).
 *
 * runOrgan(...) runs ONE organ under its arming gate and records the run as evidence. A disarmed
 * organ writes an HONEST skip beat (disarmed=true, no fake run) and never re-enqueues — the same
 * terminal-not-infinite invariant as the job-runner fix (commit 0e14660). No organ gains new
 * authority here; each adapter calls its existing entrypoint under that entrypoint's own gates.
 */
import type { OrganRunResult } from "./organ-contract.js";
import { recordOrganRun, type OrganDb } from "./organ-runs-store.js";

export interface OrganAdapter {
  organId: string;
  /** Env flag that arms the run; null = always-on (no gate, e.g. read-only projections). */
  armingFlag: string | null;
  run(env: NodeJS.ProcessEnv, now: string): Promise<OrganRunResult>;
}

/** Is this organ armed? A null flag means always armed. Accepts true/on/1 (case-insensitive). */
export function organArmed(adapter: OrganAdapter, env: NodeJS.ProcessEnv): boolean {
  if (adapter.armingFlag === null) return true;
  const v = (env[adapter.armingFlag] ?? "").trim().toLowerCase();
  return v === "true" || v === "on" || v === "1";
}

/**
 * Run one organ under its gate and record the evidence. Disarmed => honest skip beat (no run, no
 * re-enqueue). A thrown adapter is captured as ok:false (FAILED is derived downstream), never
 * crashes the caller. `perfNow` is injected so this stays testable without a real clock.
 */
export async function runOrgan(
  db: OrganDb,
  adapter: OrganAdapter,
  env: NodeJS.ProcessEnv,
  now: string,
  perfNow: () => number,
): Promise<OrganRunResult> {
  const start = perfNow();
  if (!organArmed(adapter, env)) {
    const res: OrganRunResult = { ok: false, outputRef: null, summary: `disarmed (${adapter.armingFlag})` };
    await recordOrganRun(db, adapter.organId, "scheduled", true, res, Math.round(perfNow() - start));
    return res;
  }
  let res: OrganRunResult;
  try {
    res = await adapter.run(env, now);
  } catch (e) {
    res = { ok: false, outputRef: null, summary: `threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
  }
  await recordOrganRun(db, adapter.organId, "scheduled", false, res, Math.round(perfNow() - start));
  return res;
}
