/**
 * scripts/run-council-pass.ts — P7 Plan 2: Council host glue (gated, DISARMED).
 *
 * runCouncilOnce(env, goal, now):
 *   - DISARMED → silent [] (do NOT convene the council or touch any DB).
 *   - No goal → silent [].
 *   - Armed + goal: assemble CouncilPorts → runCouncil → createCouncilProposal
 *     (persists via the proposal DB if configured, else returns the payload in the log line).
 *
 * A disarmed hook is also wired into scripts/run-live-runner.ts (separate commit).
 *
 * NODE EXECUTION HOST ONLY.  Never the Worker.  Propose-only: NEVER executes.
 */

import { pathToFileURL } from "node:url";
import { councilArmedFromEnv } from "../src/council/council-arming.js";
import { runCouncil } from "../src/council/council-coordinator.js";
import { selectPanel } from "../src/council/panel-selection.js";
import { createCouncilProposal } from "../src/council/council-proposal.js";
import { buildCouncilSpecialists, councilInferFromEnv } from "../src/council/council-specialists.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { redact } from "../src/llm/redaction.js";
import { COUNCIL_CAPS } from "../src/council/council-arming.js";
import { researchCouncilBrain } from "../src/research/research-council-adapter.js";

type Env = Record<string, string | undefined>;

/**
 * Run one council orchestration pass.  DISARMED → silent [].  No goal → silent [].
 *
 * When armed + a non-empty goal is provided:
 *   1. Assemble CouncilPorts (panel selection, specialists from env, caps from COUNCIL_CAPS).
 *   2. runCouncil (propose-only, never executes).
 *   3. createCouncilProposal (persist via the cockpit proposal DB if configured, else log).
 *
 * Never throws — errors are caught and returned as a single-element array.
 */
export async function runCouncilOnce(env: Env, goal: string, now: Date): Promise<string[]> {
  // 1. Disarmed → silent no-op.
  if (!councilArmedFromEnv(env)) return [];

  // 2. No goal → silent no-op (no autonomous goal source in this slice).
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) return [];

  // Armed + a goal: assemble ports and run.
  try {
    const infer = councilInferFromEnv(env);
    const specialists = buildCouncilSpecialists(infer, {
      research: (g) => researchCouncilBrain(g, env),
    });

    // Build a specialist map for CouncilPorts.runSpecialist.
    const specialistMap = new Map(specialists.map((s) => [s.id, s]));

    const ports = {
      isArmed: () => councilArmedFromEnv(env),
      selectPanel: (cg: { goal: string; context?: string }) => selectPanel(cg),
      runSpecialist: async (id: string, cg: { goal: string; context?: string }) => {
        const specialist = specialistMap.get(id);
        if (specialist) return specialist.run(cg);
        // Unknown specialist (should not happen with the fixed roster) — degrade.
        return { specialistId: id, lens: id, summary: "(unknown specialist)", confidence: "low" as const, risks: [], degraded: true };
      },
      caps: { maxPanel: COUNCIL_CAPS.maxPanel, maxLlmCalls: COUNCIL_CAPS.maxLlmCalls, maxDepth: COUNCIL_CAPS.maxDepth },
    };

    const result = await runCouncil({ goal: trimmedGoal }, ports, 0);

    if (result.skipped || !result.payload) {
      return [`council · skipped · ${result.reason}`];
    }

    // Persist the proposal if a DB is configured; otherwise just log the recommendation.
    const h = createCockpitProposalDb(env as NodeJS.ProcessEnv);
    if (h) {
      try {
        const proposalId = await createCouncilProposal(h.store, result.payload, now);
        return [`council · proposal created · ${proposalId} · ${result.payload.confidence} · ${result.payload.recommendation.slice(0, 80)}`];
      } finally {
        await h.close();
      }
    }

    // No DB configured — log the recommendation for visibility.
    return [
      `council · no-db · ${result.payload.confidence} · ${result.payload.recommendation.slice(0, 120)}`,
    ];
  } catch (e) {
    return [`council pass error: ${redact(String(e instanceof Error ? e.message : e))}`];
  }
}

// ── CLI entry point ─────────────────────────────────────────────────────────
const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const goal = process.argv[2] ?? "";
  runCouncilOnce(process.env, goal, new Date())
    .then((lines) => { for (const l of lines) console.log(l); })
    .catch((err) => {
      console.error(`council-pass failed: ${redact(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
}
