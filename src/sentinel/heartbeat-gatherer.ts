/**
 * src/sentinel/heartbeat-gatherer.ts — assembles the truth layer's evidence from every source
 * type the host can see, routing each raw observation through `normalizeEvidence` so the honesty
 * rule (no future/garbage timestamp is ever "fresh") is applied uniformly. PURE: no I/O, no clock.
 *
 * Sources: the answering Worker (fresh by definition), Supabase read-model snapshots (+ upstream
 * staleness), and local-runner / cron job evidence (passed in; absent ⇒ that agent stays "unknown").
 * Output feeds assessFleetLiveness().
 */

import type { AgentHeartbeat } from "./sentinel-liveness.js";
import { normalizeEvidence, type RawEvidence } from "./evidence-model.js";

export interface GathererInputs {
  nowIso: string;
  readModel: { enabledSources: string[]; staleSources: string[]; snapshotAt: string | null };
  /** Evidence the local runner / cron gathered for agents the Worker can't see directly. */
  localRunner?: RawEvidence[];
}

export function gatherHeartbeats(inputs: GathererInputs): AgentHeartbeat[] {
  const now = inputs.nowIso;
  const raw: RawEvidence[] = [
    // The Worker is answering this request ⇒ fresh self-evidence by definition.
    { agentId: "cockpit", observedAt: now, evidenceSource: "the answering Worker" },
  ];
  for (const domain of inputs.readModel.enabledSources) {
    const stale = inputs.readModel.staleSources.includes(domain);
    raw.push({
      agentId: domain,
      observedAt: inputs.readModel.snapshotAt,
      evidenceSource: stale ? `${domain} read-model diagnostics` : `${domain} read-model snapshot`,
      upstreamStale: stale || undefined,
    });
  }
  for (const ev of inputs.localRunner ?? []) {
    raw.push(ev);
  }
  // One honesty gate for every source: a non-real-past timestamp can never read as fresh.
  return raw.map((r) => normalizeEvidence(r, now));
}
