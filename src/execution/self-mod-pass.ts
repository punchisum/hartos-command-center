/**
 * src/execution/self-mod-pass.ts — Phase 6 (Amendment §6): the keystone self-mod orchestration.
 *
 * Runs one self-mod task through the whole chain: the gauntlet (executeSelfMod) verifies the change;
 * only a "kept" result has a verified change to route. Classify its tier → Tier-1 auto-deploys when the
 * circuit breaker + rate cap allow (the deploy net handles its own revert/disarm on failure); Tier-1
 * blocked, or Tier-2, captures the change as a propose-only cockpit proposal and ROLLS BACK the working
 * tree (so the daemon is clean for the next cycle). All effects are injectable ports. STILL DISARMED.
 */
import type { SelfModRunResult } from "./self-mod-executor.js";
import type { TierVerdict, SelfModClass } from "./self-mod-classifier.js";
import type { AutoApplyVerdict } from "./self-mod-armory.js";
import type { DeployResult } from "./self-mod-deploy.js";

export interface SelfModTask {
  selfModClass: SelfModClass;
  description: string;
}

export interface SelfModPassDeps {
  lastGoodSha: string;
  now: number;
  /** Run the full gauntlet (executeSelfMod over its ports). */
  runGauntlet: () => Promise<SelfModRunResult>;
  /** Lines changed (from a diff stat), for the blast-radius cap. */
  changedLines: () => number;
  /** Classify the tier given class + size. */
  classify: (selfModClass: SelfModClass, fileCount: number, changedLines: number) => TierVerdict;
  /** Circuit breaker + rate cap. */
  canAutoApply: () => AutoApplyVerdict;
  /** Tier-1: deploy + post-deploy net. Receives the verified changed-file set so the real adapter can stage only those files. */
  deploy: (lastGoodSha: string, changedFiles: string[]) => Promise<DeployResult>;
  /** Record an auto-deploy (rate cap). */
  recordAutoDeploy: (at: number) => void;
  /** Capture the kept change's diff for a Tier-2 proposal. Receives the verified changed-file set so the real adapter can read their content. */
  captureDiff: (changedFiles: string[]) => string;
  /** Tier-2: create a propose-only cockpit proposal. */
  propose: (task: SelfModTask, tier: TierVerdict, diff: string) => Promise<void>;
  /** Roll back the kept change from the working tree (Tier-2 / blocked auto-apply). */
  rollback: (changedFiles: string[]) => void;
}

export type SelfModPassAction = "none" | "deployed" | "deploy-failed" | "proposed";

export interface SelfModPassResult {
  action: SelfModPassAction;
  tier?: "auto-apply" | "propose-only";
  detail: string;
  changedFiles: string[];
}

/** Run one self-mod task end-to-end. Disarmed unless the gauntlet's amendment-gate is armed. */
export async function runSelfModPass(task: SelfModTask, deps: SelfModPassDeps): Promise<SelfModPassResult> {
  const g = await deps.runGauntlet();
  if (g.outcome !== "kept") {
    return { action: "none", detail: `gauntlet ${g.outcome}: ${g.reason}`, changedFiles: g.changedFiles };
  }

  const changed = g.changedFiles;
  const tier = deps.classify(task.selfModClass, changed.length, deps.changedLines());

  let proposeReason = tier.reason;
  if (tier.tier === "auto-apply") {
    const gate = deps.canAutoApply();
    if (gate.ok) {
      const dep = await deps.deploy(deps.lastGoodSha, changed);
      if (dep.outcome === "deployed") {
        deps.recordAutoDeploy(deps.now);
        return { action: "deployed", tier: "auto-apply", detail: `auto-deployed ${dep.deployedSha ?? "?"}`, changedFiles: changed };
      }
      // Deploy failed — the deploy net already reverted + disarmed; the tree is restored.
      return { action: "deploy-failed", tier: "auto-apply", detail: `auto-deploy ${dep.outcome}: ${dep.reason}`, changedFiles: changed };
    }
    proposeReason = `auto-apply blocked: ${gate.reason}`;
  }

  // Tier-2, or a blocked Tier-1: capture the verified change as a proposal, then roll back the tree.
  const diff = deps.captureDiff(changed);
  await deps.propose(task, tier, diff);
  deps.rollback(changed);
  return { action: "proposed", tier: "propose-only", detail: `proposed for Hart's approval — ${proposeReason}`, changedFiles: changed };
}
