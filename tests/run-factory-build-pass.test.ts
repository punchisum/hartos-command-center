/**
 * tests/run-factory-build-pass.test.ts
 *
 * The FACTORY BUILD PASS (HIGH-autonomy "build after approval"). Proves, hermetically (fake spine DB
 * + injected resolveRef + injected stage runners — NOTHING is scaffolded or deployed):
 *   (a) no approved spec ⇒ honest no-op line, NO stage called;
 *   (b) one approved spec ⇒ stages invoked IN ORDER (scaffold→pr→data→runtime);
 *   (c) a stage hard-failure STOPS the pipeline (deeper stages not run);
 *   + the pure selector (selectBuildableProposals) + PIPELINE_ORDER + deepest-artifact roll-up;
 *   + the approval floor in the SQL (status + actionType bound params) and the staging-only contract
 *     (the pass passes NO gate and forces NO production — the cores own that).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runFactoryBuildPass,
  selectBuildableProposals,
  PIPELINE_ORDER,
  BUILD_APPROVED_STATUS,
  BUILD_ACTION_TYPE,
  BUILD_MAX_PER_TICK,
  type StageRunners,
  type ProposalDbHandleLike,
} from "../scripts/run-factory-build-pass.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-15T12:00:00.000Z";

// ── Hermetic doubles ───────────────────────────────────────────────────────────

interface QueryCall {
  text: string;
  params?: unknown[];
}

/** A fake spine handle that returns the given rows for the SELECT and records every query + close. */
function fakeDb(rows: Array<{ id: string }>): { handle: ProposalDbHandleLike; queries: QueryCall[]; closed: () => boolean } {
  const queries: QueryCall[] = [];
  let wasClosed = false;
  const handle = {
    // Only the .query + .close shape is used by the pass; the rest of ProposalDbHandle is unused here.
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      return { rowCount: rows.length, rows };
    },
    close: async () => {
      wasClosed = true;
    },
  } as unknown as ProposalDbHandleLike;
  return { handle, queries, closed: () => wasClosed };
}

/** Stage runners that RECORD their call order. Each returns an artifact per the deepest-artifact test. */
function recordingStages(
  artifacts: Partial<Record<(typeof PIPELINE_ORDER)[number], string | null>> = {},
  throwAt?: (typeof PIPELINE_ORDER)[number],
): { stages: StageRunners; calls: string[] } {
  const calls: string[] = [];
  const mk =
    (name: (typeof PIPELINE_ORDER)[number]) =>
    async (_cwd: string, _id: string, _now: string, _env: NodeJS.ProcessEnv) => {
      calls.push(name);
      if (throwAt === name) throw new Error(`${name} hard-failed`);
      return { artifact: artifacts[name] ?? null, note: `${name} ran` };
    };
  return { stages: { scaffold: mk("scaffold"), pr: mk("pr"), data: mk("data"), runtime: mk("runtime") }, calls };
}

/** A resolveRef that pretends the local item exists (the pass only needs presence + an id). */
const presentResolveRef = async (_cwd: string, ref: { id: string }): Promise<ProposalQueueItem> =>
  ({ id: ref.id, status: BUILD_APPROVED_STATUS } as unknown as ProposalQueueItem);

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("factory build pass — pure helpers", () => {
  it("PIPELINE_ORDER is the fixed shallow→deep order", () => {
    assert.deepEqual([...PIPELINE_ORDER], ["scaffold", "pr", "data", "runtime"]);
  });

  it("selectBuildableProposals keeps only rows with an id, caps to max, drops wrong status/actionType", () => {
    const rows = [
      { id: "a", status: BUILD_APPROVED_STATUS, actionType: BUILD_ACTION_TYPE },
      { id: "b", status: "simulated_approved", actionType: BUILD_ACTION_TYPE }, // wrong status
      { id: "c", status: BUILD_APPROVED_STATUS, actionType: "agent_job" }, // wrong actionType
      { id: "", status: BUILD_APPROVED_STATUS }, // empty id
      { status: BUILD_APPROVED_STATUS }, // no id
      { id: "d", status: BUILD_APPROVED_STATUS, actionType: BUILD_ACTION_TYPE },
    ];
    // cap=1 (default): only the first valid row.
    assert.deepEqual(selectBuildableProposals(rows), [{ id: "a" }]);
    // cap=5: both valid rows, in order, never the rejected ones.
    assert.deepEqual(selectBuildableProposals(rows, 5), [{ id: "a" }, { id: "d" }]);
  });

  it("BUILD_MAX_PER_TICK is 1 — builds are heavy, one per tick", () => {
    assert.equal(BUILD_MAX_PER_TICK, 1);
  });
});

// ── The pass ─────────────────────────────────────────────────────────────────

describe("factory build pass — run", () => {
  it("(a) no approved spec ⇒ honest no-op line, NO stage called, db closed", async () => {
    const db = fakeDb([]); // SELECT returns nothing
    const { stages, calls } = recordingStages();
    const r = await runFactoryBuildPass({} as NodeJS.ProcessEnv, NOW, {
      makeDb: () => db.handle,
      resolveRef: presentResolveRef,
      stages,
      cwd: "/fake",
    });

    assert.equal(r.proposalId, null);
    assert.equal(r.deepestArtifact, null);
    assert.equal(r.failed, false);
    assert.deepEqual(r.stages, []);
    assert.deepEqual(calls, [], "NO stage may run when nothing is approved");
    assert.deepEqual(r.lines, ["factory-build: no approved agent spec — nothing to build"]);
    assert.ok(db.closed(), "the handle must be closed");
  });

  it("the SELECT enforces the approval floor: status + actionType are the bound params, limit 1", async () => {
    const db = fakeDb([]);
    await runFactoryBuildPass({} as NodeJS.ProcessEnv, NOW, { makeDb: () => db.handle, resolveRef: presentResolveRef, stages: recordingStages().stages, cwd: "/fake" });

    assert.equal(db.queries.length, 1);
    const q = db.queries[0]!;
    assert.match(q.text, /status = \$1/);
    assert.match(q.text, /payload->>'actionType' = \$2/);
    assert.match(q.text, /limit \$3/i);
    assert.deepEqual(q.params, [BUILD_APPROVED_STATUS, BUILD_ACTION_TYPE, BUILD_MAX_PER_TICK]);
    // The approval floor itself: only approved_for_execution agent_creation_plan can ever be selected.
    assert.equal(BUILD_APPROVED_STATUS, "approved_for_execution");
    assert.equal(BUILD_ACTION_TYPE, "agent_creation_plan");
  });

  it("(b) one approved spec ⇒ stages run IN ORDER, deepest artifact rolled up, db closed", async () => {
    const db = fakeDb([{ id: "p-1" }]);
    // PR + runtime produce artifacts; the DEEPEST (runtime worker) must win.
    const { stages, calls } = recordingStages({ scaffold: "/work/p-1", pr: "https://gh/pr/1", runtime: "worker-staging" });
    const r = await runFactoryBuildPass({} as NodeJS.ProcessEnv, NOW, {
      makeDb: () => db.handle,
      resolveRef: presentResolveRef,
      stages,
      cwd: "/fake",
    });

    assert.equal(r.proposalId, "p-1");
    assert.equal(r.failed, false);
    assert.deepEqual(calls, ["scaffold", "pr", "data", "runtime"], "pipeline must run in the fixed order");
    assert.deepEqual(r.stages.map((s) => s.stage), ["scaffold", "pr", "data", "runtime"]);
    assert.ok(r.stages.every((s) => s.ok));
    assert.equal(r.deepestArtifact, "worker-staging", "deepest real artifact wins (deploy > pr > scaffold)");
    assert.ok(db.closed());
  });

  it("(b') a fully dry-ran build (no artifacts) is an honest PARTIAL, not a failure", async () => {
    const db = fakeDb([{ id: "p-2" }]);
    const { stages, calls } = recordingStages(); // every stage returns artifact:null (closed gates)
    const r = await runFactoryBuildPass({} as NodeJS.ProcessEnv, NOW, { makeDb: () => db.handle, resolveRef: presentResolveRef, stages, cwd: "/fake" });

    assert.equal(r.proposalId, "p-2");
    assert.equal(r.failed, false, "a closed-gate dry-run is NOT a failure");
    assert.equal(r.deepestArtifact, null);
    assert.deepEqual(calls, ["scaffold", "pr", "data", "runtime"]);
  });

  it("(c) a stage hard-failure STOPS the pipeline — deeper stages are not run", async () => {
    const db = fakeDb([{ id: "p-3" }]);
    // scaffold ok (artifact), pr THROWS → data + runtime must NOT run.
    const { stages, calls } = recordingStages({ scaffold: "/work/p-3" }, "pr");
    const r = await runFactoryBuildPass({} as NodeJS.ProcessEnv, NOW, {
      makeDb: () => db.handle,
      resolveRef: presentResolveRef,
      stages,
      cwd: "/fake",
    });

    assert.equal(r.failed, true);
    assert.deepEqual(calls, ["scaffold", "pr"], "data + runtime must NOT run after a hard failure");
    assert.equal(r.stages[0]!.ok, true);
    assert.equal(r.stages[1]!.ok, false);
    assert.equal(r.stages.length, 2);
    // The deepest REAL artifact reached before the stop is surfaced honestly.
    assert.equal(r.deepestArtifact, "/work/p-3");
    assert.ok(r.lines.some((l) => /HARD FAIL/.test(l)));
    assert.ok(db.closed());
  });

  it("an approved spine row missing from the local queue ⇒ honest skip (cores read the local item)", async () => {
    const db = fakeDb([{ id: "ghost" }]);
    const { stages, calls } = recordingStages();
    const r = await runFactoryBuildPass({} as NodeJS.ProcessEnv, NOW, {
      makeDb: () => db.handle,
      resolveRef: async () => null, // not in the local queue
      stages,
      cwd: "/fake",
    });

    assert.equal(r.proposalId, "ghost");
    assert.deepEqual(calls, [], "no stage runs when the local item is absent");
    assert.deepEqual(r.stages, []);
    assert.ok(r.lines.some((l) => /not in the local queue/.test(l)));
    assert.ok(db.closed());
  });

  it("no spine DB configured ⇒ honest skip, no stage called", async () => {
    const { stages, calls } = recordingStages();
    const r = await runFactoryBuildPass({} as NodeJS.ProcessEnv, NOW, {
      makeDb: () => null,
      resolveRef: presentResolveRef,
      stages,
      cwd: "/fake",
    });
    assert.equal(r.proposalId, null);
    assert.deepEqual(calls, []);
    assert.ok(r.lines.some((l) => /no spine DB/.test(l)));
  });
});
