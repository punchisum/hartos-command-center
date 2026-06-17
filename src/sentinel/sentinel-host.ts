/**
 * src/sentinel/sentinel-host.ts — the Node HOST edge for Sentinel (local evidence gathering).
 *
 * Reads each agent's newest LOCAL evidence (artifact-dir mtimes + the memory-capture file)
 * into `AgentHeartbeat`s for the pure core. Shared by the Sentinel CLI and the Wolverine
 * audit host so the evidence map lives in exactly one place. Read-only filesystem access;
 * never imported by the Worker.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentHeartbeat } from "./sentinel-liveness.js";

/** agentId → the local artifact dir whose newest file is that agent's evidence. */
export const EVIDENCE_DIRS: Record<string, string> = {
  orchestrator: "hartos-reports",
  cockpit: "cockpit-reports",
  research: "research-reports",
  beezulbub: "beezulbub-reports",
  factory: "agent-scaffold",
  supabase: "read-model-reports",
};

function newestMtime(dir: string): number | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  let newest: number | null = null;
  for (const name of names) {
    try {
      const t = statSync(join(dir, name)).mtimeMs;
      if (newest === null || t > newest) newest = t;
    } catch {
      // raced away — skip
    }
  }
  return newest;
}

/** Gather heartbeats from the local artifact dirs + the memory-capture file. */
export function gatherLocalHeartbeats(env: Record<string, string | undefined>): AgentHeartbeat[] {
  const heartbeats: AgentHeartbeat[] = [];
  for (const [agentId, dir] of Object.entries(EVIDENCE_DIRS)) {
    const t = newestMtime(dir);
    heartbeats.push({
      agentId,
      lastEvidenceAt: t === null ? null : new Date(t).toISOString(),
      evidenceSource: `${dir}/ newest artifact`,
      hostBound: true,
    });
  }
  const memPath = env["HARTOS_MEMORY_CAPTURE"];
  if (memPath && memPath.trim().length > 0) {
    try {
      const st = statSync(memPath);
      heartbeats.push({
        agentId: "executive-memory",
        lastEvidenceAt: new Date(st.mtimeMs).toISOString(),
        evidenceSource: "memory-capture file",
        hostBound: true,
      });
    } catch {
      heartbeats.push({
        agentId: "executive-memory",
        lastEvidenceAt: null,
        evidenceSource: "memory-capture file (missing)",
        hostBound: true,
      });
    }
  }
  return heartbeats;
}
