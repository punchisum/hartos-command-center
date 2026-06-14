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

  const stale = ev.heartbeatAgeSec !== null && ev.heartbeatAgeSec > ev.stalenessThresholdSec;
  if (ev.lastRun && ev.lastRun.ok === false) return "FAILED";
  if (stale) return "FAILED";

  const fresh = ev.heartbeatAgeSec !== null && ev.heartbeatAgeSec <= ev.stalenessThresholdSec;
  const realRun =
    !!ev.lastRun &&
    ev.lastRun.disarmed === false &&
    ev.lastRun.ok === true &&
    REAL_TRIGGERS.includes(ev.lastRun.trigger);
  const hasOutput = !!(ev.lastRun && ev.lastRun.outputRef);

  if (fresh && realRun && hasOutput && ev.readbackOk) return "LIVE";
  if (fresh || ev.lastRun) return "PARTIAL";
  return "REGISTERED";
}
