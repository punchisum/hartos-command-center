/**
 * src/organs/derive-organ-status.ts — the SP-Organs status deriver.
 *
 * PURE, never throws. Status from EVIDENCE ONLY — never hardcoded (doctrine: UI = Reflect(SOT)).
 * LIVE requires ALL FOUR (spec constraint #2): fresh heartbeat · real scheduled/on-demand/worker run
 * · output_ref · cockpit readback. Anything short of that is REGISTERED/PARTIAL; a failed/stale organ
 * is FAILED; a retired organ is RETIRED.
 */
import type { OrganEvidence, OrganStatus, OrganTrigger } from "./organ-contract.js";

const REAL_TRIGGERS: readonly OrganTrigger[] = ["scheduled", "on_demand", "worker"];

export function deriveOrganStatus(ev: OrganEvidence): OrganStatus {
  if (ev.lifecycleRetired) return "RETIRED";

  // FAILED is reserved for genuine breakage: an errored run (an escaped throw) or a stale heartbeat.
  // An honest ok:false (disarmed-by-policy, or "ran but not yet at the LIVE bar") is NOT a failure —
  // it is PARTIAL. Conflating the two would render disarmed/partial organs as FAILED (a dishonest cockpit).
  const stale = ev.heartbeatAgeSec !== null && ev.heartbeatAgeSec > ev.stalenessThresholdSec;
  if (ev.lastRun && ev.lastRun.errored) return "FAILED";
  if (stale) return "FAILED";

  const fresh = ev.heartbeatAgeSec !== null && ev.heartbeatAgeSec <= ev.stalenessThresholdSec;
  const realRun =
    !!ev.lastRun &&
    ev.lastRun.disarmed === false &&
    ev.lastRun.ok === true &&
    REAL_TRIGGERS.includes(ev.lastRun.trigger);
  const hasOutput = !!(ev.lastRun && ev.lastRun.outputRef);

  if (fresh && realRun && hasOutput && ev.readbackOk) return "LIVE";

  // DISARMED: the organ's gate is off — an honest "turned off", not idle-ready.
  if (ev.lastRun && ev.lastRun.disarmed) return "DISARMED";

  // STANDBY: armed + ran cleanly (no error) + produced nothing = ready, but no work to do right now
  // (e.g. council with no goal, factory with no approved spec). This is NOT "PARTIAL" (half-broken) —
  // the organ is healthy and waiting for a trigger; it goes LIVE the moment it has real work.
  if (ev.lastRun && ev.lastRun.ok === false && !ev.lastRun.outputRef) return "STANDBY";

  // PARTIAL: ran and has SOME evidence but fell short of the four-part LIVE gate (e.g. produced an
  // output but no readback, or ok but not fresh) — genuinely part-way, not merely idle.
  if (fresh || ev.lastRun) return "PARTIAL";
  return "REGISTERED";
}
