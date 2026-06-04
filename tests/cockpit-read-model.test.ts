/**
 * tests/cockpit-read-model.test.ts
 *
 * Phase 11H — cockpit read model tests. LOCAL only, degrades safely.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCockpitState } from "../src/cockpit/cockpit-read-model.js";

async function makeTmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cockpit-read-model-"));
}

describe("cockpit read model", () => {
  let dir: string;
  before(async () => { dir = await makeTmp(); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("builds state from the command-center contract (22 cards, 5 groups)", async () => {
    const state = await buildCockpitState({ cwd: dir });
    assert.equal(state.cards.length, 22);
    assert.equal(state.groups.length, 5);
    assert.equal(state.mode, "local");
    assert.equal(state.summary.cardCount, 22);
  });

  it("annotates each action with a safety state and marks none executable", async () => {
    const state = await buildCockpitState({ cwd: dir });
    for (const card of state.cards) {
      for (const action of card.actions) {
        assert.equal(action.executable, false, `${action.action} must not be executable in 11H`);
        assert.ok(["read_only", "local_report_generation", "approval_required", "manual_required", "forbidden", "future"].includes(action.state));
      }
    }
  });

  it("exposes forbidden actions including execute_provider_mutation", async () => {
    const state = await buildCockpitState({ cwd: dir });
    assert.ok(state.forbiddenActions.includes("execute_provider_mutation"));
    assert.ok(state.approvalRequiredActions.includes("promote_pack"));
    assert.ok(state.manualRequiredActions.includes("deploy_agent"));
  });

  it("degrades safely with no reports present", async () => {
    const state = await buildCockpitState({ cwd: dir });
    assert.equal(state.reports.length, 0);
    assert.equal(state.latestResponse, null);
    assert.ok(state.summary.nextRecommendedCommand.startsWith("npm run"));
  });

  it("lists local reports when present", async () => {
    const reportsDir = path.join(dir, "hartos-reports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, "orchestrator-2026.md"), "# r\n", "utf8");
    const state = await buildCockpitState({ cwd: dir });
    assert.ok(state.reports.some((r) => r.relativePath === "hartos-reports/orchestrator-2026.md"));
  });
});
