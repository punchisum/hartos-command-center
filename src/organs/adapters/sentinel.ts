/**
 * src/organs/adapters/sentinel.ts — the Sentinel organ adapter.
 *
 * Entrypoint = assessFleetLiveness (src/sentinel/sentinel-liveness.ts) — the PURE fleet-heartbeat
 * core that folds the meta-agent registry with host-gathered heartbeats into per-agent
 * up/stale/down/unknown verdicts + a GREEN/AMBER/RED rollup. This adapter assembles the two cheap,
 * Worker-safe inputs the core needs — the deterministic registry (resolveMetaAgentRegistry) and the
 * answering-process heartbeat (this runner is alive ⇒ fresh evidence for the cockpit node) — and runs
 * the assessment. Heavy evidence sources (read-model diagnostics, artifact dirs, pulse runs) are NOT
 * cheaply assemblable here, so they stay absent: the core HONESTLY reports those agents "unknown"
 * rather than assuming them up. That is an honest PARTIAL view, not a fabrication.
 *
 * Doctrine: status is DERIVED from evidence; never fake ok:true. The core ALWAYS returns a real
 * verdict (absence of evidence IS a verdict — unknown/AMBER), so ok=true means "Sentinel produced a
 * fleet verdict", not "the fleet is healthy" — the verdict colour lives in the summary/outputRef.
 * Thin: it calls the existing fn, reimplements nothing, adds no external side-effects, and is
 * always-on (armingFlag is declared per task but read-only assessment carries no mutation authority).
 * Any throw → honest ok:false beat.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { resolveMetaAgentRegistry } from "../../agents/meta-agent-registry.js";
import { assessFleetLiveness, type AgentHeartbeat } from "../../sentinel/sentinel-liveness.js";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

export const sentinelOrgan: OrganAdapter = {
  organId: "sentinel",
  armingFlag: "HARTOS_ALLOW_SENTINEL_WOLVERINE",
  async run(env: NodeJS.ProcessEnv, now: string): Promise<OrganRunResult> {
    try {
      // Cheap, Worker-safe inputs: the deterministic registry (who SHOULD be running) + the one
      // heartbeat this runner can honestly assert — itself answering ⇒ the cockpit node is fresh.
      const registry = resolveMetaAgentRegistry({ now, env });
      const heartbeats: AgentHeartbeat[] = [
        { agentId: "cockpit", lastEvidenceAt: now, evidenceSource: "the answering organ runner" },
      ];
      const fleet = assessFleetLiveness(registry, heartbeats, now);
      // A verdict was produced ⇒ ok:true. The colour (GREEN/AMBER/RED) is honest evidence, not health.
      return {
        ok: true,
        outputRef: `fleet:${fleet.overall}`,
        summary: cap(`Sentinel — fleet liveness ${fleet.overall} (${fleet.overallReason})`),
        detail: {
          overall: fleet.overall,
          counts: fleet.counts,
          generatedAt: fleet.generatedAt,
          // Honesty: most agents are "unknown" because heavy heartbeat evidence isn't assembled here.
          assessedWithEvidence: heartbeats.map((h) => h.agentId),
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`sentinel liveness assessment failed: ${msg}`) };
    }
  },
};
