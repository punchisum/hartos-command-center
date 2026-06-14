/**
 * scripts/run-sentinel-wolverine-pass.ts — Sentinel→Wolverine auto-engagement pass (gated).
 *
 * Each pass folds the registry with locally-gathered heartbeats via the PURE assessFleetLiveness,
 * then raises an ADVISORY, propose-only Wolverine FixProposal for every expected-live agent that is
 * down/stale (idempotent upsert — stable id per agent+state). So a degradation auto-engages
 * Wolverine + surfaces in the cockpit, not just a Telegram ping. Propose-only: never restarts an
 * agent. DISARMED by default — armed by HARTOS_ALLOW_SENTINEL_WOLVERINE=true (kill-switch dominates).
 *
 * NODE host only (gathers local artifact evidence + writes via the elevated proposal store).
 */
import { pathToFileURL } from "node:url";
import { resolveMetaAgentRegistry } from "../src/agents/meta-agent-registry.js";
import { assessFleetLiveness } from "../src/sentinel/sentinel-liveness.js";
import { gatherLocalHeartbeats } from "../src/sentinel/sentinel-host.js";
import { sentinelWolverineProposals } from "../src/wolverine/sentinel-wolverine-bridge.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { redact } from "../src/llm/redaction.js";

type Env = Record<string, string | undefined>;

/** Fail-closed: armed only by HARTOS_ALLOW_SENTINEL_WOLVERINE=true AND kill-switch off. */
export function sentinelWolverineArmed(env: Env): boolean {
  if (String(env["HARTOS_EXECUTION_KILL_SWITCH"] ?? "").trim().toLowerCase() === "on") return false;
  return String(env["HARTOS_ALLOW_SENTINEL_WOLVERINE"] ?? "").trim() === "true";
}

/**
 * Run one Sentinel→Wolverine pass. DISARMED → []. No down/stale agents → []. Never throws.
 */
export async function runSentinelWolverineOnce(env: Env, now: string): Promise<string[]> {
  if (!sentinelWolverineArmed(env)) return [];
  try {
    const registry = resolveMetaAgentRegistry({ now, env });
    const heartbeats = gatherLocalHeartbeats(env);
    const fleet = assessFleetLiveness(registry, heartbeats, now);
    const proposals = sentinelWolverineProposals(fleet, now);
    if (proposals.length === 0) return [];

    const h = createCockpitProposalDb(env as NodeJS.ProcessEnv);
    if (!h) {
      return [`sentinel-wolverine · ${proposals.length} finding(s) but no proposal DB — not persisted`];
    }
    try {
      let n = 0;
      for (const p of proposals) {
        await h.store.upsert(p);
        n += 1;
      }
      return [`sentinel-wolverine · raised ${n} advisory FixProposal(s): ${proposals.map((p) => p.targetId).join(", ")}`];
    } finally {
      await h.close();
    }
  } catch (e) {
    return [`sentinel-wolverine pass error: ${redact(String(e instanceof Error ? e.message : e))}`];
  }
}

// ── CLI entry point ─────────────────────────────────────────────────────────
const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runSentinelWolverineOnce(process.env, new Date().toISOString())
    .then((lines) => { for (const l of lines) console.log(l); })
    .catch((err) => {
      console.error(`sentinel-wolverine-pass failed: ${redact(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
}
