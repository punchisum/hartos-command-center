/**
 * scripts/prophet-forecast.ts — Prophet's consequence-of-inaction forecast CLI (the host edge).
 *
 * Prophet projects the logical CONSEQUENCE of leaving KNOWN issues unaddressed — it never
 * predicts the world. This host gathers the knowledge-loop signals Prophet now reasons over and
 * runs the pure `forecast`:
 *   - Wolverine's immune-system report (env flags + git facts + the cockpit's own staleSources):
 *     each finding is a defect that doesn't self-heal → its consequence-of-inaction.
 *   - Executive Memory (the durable snapshot store, or the state-resolver's snapshots): recurring
 *     patterns + rising problem-count trends — the across-time "becoming a standing condition"
 *     signal a single snapshot can't produce.
 *   - The live proposal queue: stalled-decision consequences.
 *
 * Read-only: it inspects + reports; it NEVER mutates, deploys, or repairs. Perception/orchestration
 * consequences are folded by the cockpit suggestion path (which has the freshness surface); this CLI
 * leads with the two newest signals and is honest about what it did not assess.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/prophet-forecast.js
 */

import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { forecast, summarizeForecast, type ForecastReport, type Consequence } from "../src/prophet/forecast.js";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { executiveMemory } from "../src/awareness/executive-memory.js";
import { createCockpitMemoryDb } from "../src/awareness/supabase-memory-db.js";
import { resolveHostedCockpitState } from "../src/runtime/cloudflare-live-read-models.js";
import type { GitFacts } from "../src/wolverine/wolverine-types.js";
import type { MemorySnapshot } from "../src/awareness/executive-memory.js";

function gatherGitFacts(cwd: string): GitFacts | undefined {
  const git = (args: string): string | null => {
    try {
      return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const branch = git("rev-parse --abbrev-ref HEAD");
  if (branch === null) return undefined;
  const porcelain = git("status --porcelain");
  const lines = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const uncommitted = lines.length - untracked;
  let ahead: number | null = null;
  let hasUpstream = false;
  const a = git("rev-list --count @{u}..HEAD");
  if (a !== null && /^\d+$/.test(a)) {
    ahead = Number(a);
    hasUpstream = true;
  }
  return { branch, uncommitted, untracked, ahead, hasUpstream };
}

const SEV_TAG: Record<Consequence["severity"], string> = { high: "[HIGH]", medium: "[MED ]", low: "[LOW ]" };
const HORIZON_TAG: Record<Consequence["horizon"], string> = { now: "now", days: "days", "week+": "week+" };

/** Pure renderer (testable, no I/O) — the consequence-of-inaction forecast as lines. */
export function renderForecast(report: ForecastReport): string[] {
  const out: string[] = [];
  out.push(`\nProphet — consequence-of-inaction forecast (read-only; projects, never predicts)`);
  out.push(`  ${summarizeForecast(report)}`);
  out.push(`  Scanned: ${report.scanned.length ? report.scanned.join(", ") : "nothing"}`);
  if (report.consequences.length === 0) {
    out.push("  No projected consequences — nothing known is being left to rot. That's a clear read, not a blind one.");
  } else {
    out.push(`\n  If nothing changes (worst first):`);
    for (const c of report.consequences) {
      out.push(`  ${SEV_TAG[c.severity]} (${HORIZON_TAG[c.horizon]}) ${c.subject}`);
      out.push(`         so what: ${c.projection}`);
      out.push(`         basis:   ${c.basis}`);
      out.push(`         prevent: ${c.preventedBy}`);
    }
  }
  if (report.blindSpots.length) {
    out.push(`\n  Cannot foresee (no evidence): ${report.blindSpots.join("; ")}.`);
  }
  return out;
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void (async () => {
    const cwd = process.cwd();
    const now = new Date().toISOString();

    // Live state for staleSources, the proposal queue, and (when capture is on) memory snapshots.
    const state = await resolveHostedCockpitState(process.env, { now }).catch(() => null);
    const staleSources = state?.sourceDiagnostics?.staleSources ?? [];

    // 1) Wolverine immune-system report (read-only host gathering).
    const wolverine = wolverineAudit({ now, env: process.env, git: gatherGitFacts(cwd), staleSources });

    // 2) Executive memory — prefer the resolver's snapshots; else read the durable store directly.
    let history: MemorySnapshot[] = state?.memorySnapshots ?? [];
    const handle = history.length === 0 ? createCockpitMemoryDb(process.env) : null;
    if (handle) {
      try {
        history = await handle.store.read();
      } catch {
        history = [];
      } finally {
        await handle.close();
      }
    }
    const memory = history.length ? executiveMemory(history, { now }) : null;

    // 3) Run the pure forecast over the knowledge-loop signals + the live proposal queue.
    const report = forecast({ now, wolverine, memory, proposals: state?.proposalQueue ?? [] });
    for (const line of renderForecast(report)) console.log(line);
    console.log(
      memory
        ? ""
        : "\n  (No executive-memory history yet — run cockpit:memory-capture daily; recurring-pattern + trend consequences need ≥3 snapshots.)",
    );
  })();
}
