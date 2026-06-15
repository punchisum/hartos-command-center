/**
 * src/organs/adapters/council.ts — the Council organ adapter.
 *
 * Entrypoint = runCouncil(goal, ports, depth) (src/council/council-coordinator.ts) — the recursive,
 * depth-capped, PROPOSE-ONLY coordinator. It NEVER executes; it only fuses specialist findings into a
 * CouncilProposalPayload. The host glue in scripts/run-council-pass.ts wires the full LLM specialist
 * roster + a pg-backed proposal DB — far too heavy (and stateful) for a bounded organ pulse, so this
 * adapter calls runCouncil DIRECTLY with thin, bounded ports instead of importing that script.
 *
 * Bounded by design: the panel comes from the pure selectPanel(), and runSpecialist returns an HONEST
 * degraded finding (LLM-off) rather than firing any model. That is the same self-degrade contract the
 * script's "unknown specialist" fallback uses — so the coordinator produces a REAL propose-only plan
 * with ZERO LLM calls. The synthesis honestly floors confidence to `low` (no non-degraded findings):
 * that is honest evidence of a thin pulse, never a fabricated verdict.
 *
 * Doctrine: status DERIVED from evidence; never fake ok:true; honest PARTIAL when there is no goal.
 *  - No goal (HARTOS_COUNCIL_GOAL empty) → PARTIAL ok:false. We do NOT invent a goal (no autonomous
 *    goal source exists in this slice), exactly as the script no-ops on an empty goal.
 *  - Goal present → ok:true ONLY when runCouncil returns a payload (a council plan was produced).
 *    outputRef = the deterministic council proposal id (the SOT handle createCouncilProposal would
 *    mint for this run's clock); summary = the council verdict + confidence band.
 *  - Council is propose-only: this adapter touches no DB and triggers no execution. Any throw → ok:false.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { runCouncil, type CouncilPorts } from "../../council/council-coordinator.js";
import { selectPanel } from "../../council/panel-selection.js";
import { COUNCIL_CAPS, KILL_SWITCH_ENV } from "../../council/council-arming.js";
import type { CouncilGoal, SpecialistFinding } from "../../council/council-types.js";

/** The env var that supplies the council's goal. No goal ⇒ no autonomous source ⇒ honest PARTIAL. */
export const COUNCIL_GOAL_ENV = "HARTOS_COUNCIL_GOAL";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

/**
 * Deterministic council proposal id for this run's clock — mirrors makeCouncilProposalId in
 * council-proposal.ts (colon/dot-free, DB + filename safe) so the outputRef is the SAME handle the
 * proposal spine would mint, without this adapter taking on any DB (pg) authority.
 */
function councilProposalId(now: string): string {
  const iso = Number.isNaN(Date.parse(now)) ? new Date(0).toISOString() : new Date(now).toISOString();
  return `prop-council-${iso.replace(/[:.]/g, "-")}`;
}

export const councilOrgan: OrganAdapter = {
  organId: "council",
  armingFlag: "HARTOS_ALLOW_COUNCIL",
  async run(env: NodeJS.ProcessEnv, now: string): Promise<OrganRunResult> {
    // Honest PARTIAL: no goal ⇒ nothing to convene. Do NOT invent a goal.
    const goal = (env[COUNCIL_GOAL_ENV] ?? "").trim();
    if (goal === "") {
      return {
        ok: false,
        outputRef: null,
        summary: "council needs HARTOS_COUNCIL_GOAL (no autonomous goal source)",
      };
    }

    try {
      // Bounded ports: pure panel selection + LLM-off specialists (honest degraded findings, no model
      // calls), single-level (no sub-coordinator recursion). Propose-only: runCouncil never executes.
      const ports: CouncilPorts = {
        // The supervisor (runOrgan) only invokes run() when this organ is armed (HARTOS_ALLOW_COUNCIL),
        // so arming is already proven at the gate; this seam reports armed so the coordinator proceeds.
        // The kill-switch is still honoured: an explicit kill flips it back to disarmed (fail-closed).
        isArmed: () => (env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() !== "on",
        selectPanel: (cg: CouncilGoal) => selectPanel(cg),
        runSpecialist: async (id: string): Promise<SpecialistFinding> => ({
          specialistId: id,
          lens: id,
          summary: "(LLM-off in organ pulse — no specialist call made)",
          confidence: "low",
          risks: [],
          degraded: true,
        }),
        caps: { maxPanel: COUNCIL_CAPS.maxPanel, maxLlmCalls: COUNCIL_CAPS.maxLlmCalls, maxDepth: 1 },
      };

      const result = await runCouncil({ goal }, ports, 0);

      // Skipped (e.g. disarmed at the ports' kill-switch check) or no payload ⇒ honest non-success.
      if (result.skipped || !result.payload) {
        return { ok: false, outputRef: null, summary: cap(`council produced no plan: ${result.reason}`) };
      }

      // A council plan was produced ⇒ ok:true. outputRef = the SOT proposal handle; the confidence
      // band is honest evidence (floored to `low` here because the pulse ran LLM-off), not health.
      const p = result.payload;
      return {
        ok: true,
        outputRef: councilProposalId(now),
        summary: cap(`Council verdict (${p.confidence}) propose-only: ${p.recommendation}`),
        detail: {
          confidence: p.confidence,
          llmCallsUsed: p.llmCallsUsed,
          panel: p.tree.panel,
          degradedFindings: p.tree.findings.filter((f) => f.degraded).length,
          proposeOnly: true,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`council pass failed: ${msg}`) };
    }
  },
};
