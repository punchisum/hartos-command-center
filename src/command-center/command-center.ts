/**
 * src/command-center/command-center.ts
 *
 * Entry point that ties the Command Center contract together. It assembles the
 * data contract, builds the read model from LOCAL sources, and produces the
 * cockpit plan. It performs NO mutation, NO network calls, and NO action
 * execution. It is the thin layer a future cockpit UI (Phase 11H+) will consume.
 *
 * Orchestrator = brain. Command Center = read/control surface.
 */

import path from "node:path";
import type {
  CardReadModel,
  CockpitPlan,
  DataContract,
} from "./command-center-types.js";
import { buildDataContract } from "./data-contract.js";
import { buildReadModel } from "./read-model.js";
import { buildCockpitPlan } from "./cockpit-plan.js";

export { DEFAULT_REPORTS_DIR } from "./command-center-report.js";

export interface CommandCenterOptions {
  cwd?: string;
}

export interface CommandCenterSnapshot {
  contract: DataContract;
  readModels: CardReadModel[];
  plan: CockpitPlan;
  generatedAt: string;
}

/**
 * Build a full, deterministic snapshot of the Command Center state. Safe to run
 * with no reports present — every card degrades gracefully.
 */
export async function buildCommandCenterSnapshot(
  options: CommandCenterOptions = {}
): Promise<CommandCenterSnapshot> {
  const cwd = options.cwd ?? process.cwd();
  const now = new Date();

  const contract = buildDataContract(now);
  const readModels = await buildReadModel({ cwd });
  const plan = buildCockpitPlan(readModels, now);

  return {
    contract,
    readModels,
    plan,
    generatedAt: now.toISOString(),
  };
}

export function resolveReportsDir(cwd: string, override?: string): string {
  if (override) return path.resolve(cwd, override);
  return path.resolve(cwd, "command-center-reports");
}
