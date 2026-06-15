/**
 * scripts/run-factory-build-pass.ts — the FACTORY BUILD PASS (HIGH-autonomy "build after approval").
 *
 * Each tick this finds Hart-APPROVED agent-creation specs in the cockpit spine and autonomously runs
 * the FULL build pipeline on ONE of them — scaffold (18A) → PR (18B) → data-provision (18C) →
 * runtime-deploy (18D) — by SEQUENCING the existing gated cores. It adds NO new authority: every
 * stage still enforces its OWN gates exactly as the CLIs do.
 *
 * THE APPROVAL FLOOR IS SACRED. The spine select restricts to status='approved_for_execution' +
 * actionType='agent_creation_plan'; and INDEPENDENTLY each core re-checks resolveRef(...).status ===
 * "approved_for_execution" (Key 1) and refuses otherwise. An unapproved/prompt-injected proposal can
 * never build — even if the select were wrong, the cores fail closed.
 *
 * PRODUCTION IS UNREACHABLE. This pass passes NO env, sets NO gate, and forces NO target. Each core
 * reads gates from the host env and (18C/18D) hard-refuses production / deploys to *.workers.dev /
 * staging only. A closed gate makes that core DRY-RUN and report — that is the expected, honest
 * outcome, NOT a failure. We never override a core's production refusal.
 *
 * HONEST NO-OP. No approved spec ⇒ a single PARTIAL line; nothing is built and nothing is faked.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/run-factory-build-pass.js
 */

import { pathToFileURL } from "node:url";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { resolveRef as realResolveRef } from "../src/cockpit/proposals/proposal-queue.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";
import {
  runLocalScaffoldBuild,
  runGithubPrMode,
  runDataLayerProvision,
  runRuntimeProvision,
} from "../src/execution/index.js";
import { redact } from "../src/llm/redaction.js";

/**
 * The minimal spine-handle shape this pass needs: a parameterized `query` + a `close`. Structurally
 * satisfied by ProposalDbHandle (the real handle) AND by a test double — so tests inject a fake DB
 * without standing up postgres.
 */
export interface ProposalDbHandleLike {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number | null; rows: unknown[] }>;
  close: () => Promise<void>;
}

/** The approval floor: ONLY a Hart-approved spec builds. Mirrors the cores' own Key-1 re-check. */
export const BUILD_APPROVED_STATUS = "approved_for_execution";
/** The action type the build pipeline supports (every core also re-checks this and refuses otherwise). */
export const BUILD_ACTION_TYPE = "agent_creation_plan";
/** Builds are heavy — at most ONE proposal is built per tick. */
export const BUILD_MAX_PER_TICK = 1;

/** A buildable spine row: just the id (the cores resolve the full item locally + re-verify it). */
export interface BuildableProposalRow {
  id: string;
}

/**
 * The fixed pipeline order. 18A scaffold must precede 18B PR / 18C data / 18D runtime (each later
 * stage reads the local scaffold workdir / build manifest the earlier stage produced).
 */
export const PIPELINE_ORDER = ["scaffold", "pr", "data", "runtime"] as const;
export type PipelineStage = (typeof PIPELINE_ORDER)[number];

/**
 * PURE selector — from raw spine rows, keep only buildable ones (defensive even though the SQL already
 * filters), newest-claimed first preserved by the query, capped to `max`. Extracted so the SELECT +
 * cap + ordering logic is unit-testable without a database.
 */
export function selectBuildableProposals(
  rows: Array<{ id?: unknown; status?: unknown; actionType?: unknown }>,
  max: number = BUILD_MAX_PER_TICK,
): BuildableProposalRow[] {
  const out: BuildableProposalRow[] = [];
  for (const r of rows) {
    if (typeof r.id !== "string" || r.id.length === 0) continue;
    // The cores re-verify status + actionType; this is a belt-and-braces filter, never a bypass.
    if (r.status != null && r.status !== BUILD_APPROVED_STATUS) continue;
    if (r.actionType != null && r.actionType !== BUILD_ACTION_TYPE) continue;
    out.push({ id: r.id });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The four gated stage runners, as a thin injectable seam. Defaults are the REAL cores — the seam
 * exists ONLY so tests can assert ordering + early-stop without scaffolding/deploying. Each runner
 * returns a deepest-artifact string (or null) for the deepest-real-artifact roll-up, and throws on a
 * HARD failure (which stops the pipeline). A core's closed-gate DRY-RUN is NOT a throw — it returns
 * its (gated) artifact/null and the pipeline continues honestly.
 */
export interface StageRunners {
  scaffold(cwd: string, id: string, now: string, env: NodeJS.ProcessEnv): Promise<{ artifact: string | null; note: string }>;
  pr(cwd: string, id: string, now: string, env: NodeJS.ProcessEnv): Promise<{ artifact: string | null; note: string }>;
  data(cwd: string, id: string, now: string, env: NodeJS.ProcessEnv): Promise<{ artifact: string | null; note: string }>;
  runtime(cwd: string, id: string, now: string, env: NodeJS.ProcessEnv): Promise<{ artifact: string | null; note: string }>;
}

/** Real stage runners — each just calls the existing gated core with the proposal id as the ref. */
export const realStageRunners: StageRunners = {
  async scaffold(cwd, id, now, env) {
    const r = await runLocalScaffoldBuild({ cwd, ref: { id }, now, env });
    return { artifact: r.workDir, note: `scaffold ${r.files.length} file(s) on ${r.branch} (pushed=${r.pushed}, providerMutations=${r.providerMutations})` };
  },
  async pr(cwd, id, now, env) {
    const r = await runGithubPrMode({ cwd, ref: { id }, now, env });
    return { artifact: r.prUrl, note: `pr ${r.mode}${r.prUrl ? ` ${r.prUrl}` : ""} (pushed=${r.pushed}, merged=${r.merged})` };
  },
  async data(cwd, id, now, env) {
    const r = await runDataLayerProvision({ cwd, ref: { id }, now, env });
    return { artifact: r.applied ? `migrations:${r.projectRef ?? "?"}` : null, note: `data ${r.mode} (${r.migrationCount} migration(s), risk=${r.overallRisk}, providerMutations=${r.providerMutations})` };
  },
  async runtime(cwd, id, now, env) {
    const r = await runRuntimeProvision({ cwd, ref: { id }, now, env });
    // Deepest artifact only when a worker was actually deployed (mode==="deployed"); a dry-run worker
    // NAME is a plan, not a live artifact.
    const artifact = r.mode === "deployed" && r.workerName ? r.workerName : null;
    return { artifact, note: `runtime ${r.mode}${r.workerName ? ` worker=${r.workerName}` : ""} (env=${r.targetEnv ?? "?"}, advanced=${r.advanced})` };
  },
};

/** A stage in the rolled-up result: which stage, what it produced, and whether it hard-failed. */
export interface FactoryStageOutcome {
  stage: PipelineStage;
  ok: boolean;
  /** The deepest REAL artifact this stage produced (deploy worker / PR url / scaffold path), or null. */
  artifact: string | null;
  note: string;
}

export interface FactoryBuildPassResult {
  /** A built proposal id, or null when nothing was buildable. */
  proposalId: string | null;
  stages: FactoryStageOutcome[];
  /** Deepest real artifact across stages: deployed worker > PR url > scaffold path; null if none. */
  deepestArtifact: string | null;
  /** True only when a stage HARD-failed (a closed-gate dry-run is NOT a failure). */
  failed: boolean;
  lines: string[];
}

/** Injectable dependencies — all default to the real implementations. Tests override these. */
export interface FactoryBuildPassDeps {
  /** Build the spine DB handle (null when HARTOS_SUPABASE_DB_URL is unset → honest skip). */
  makeDb?: (env: NodeJS.ProcessEnv) => ProposalDbHandleLike | null;
  /** Resolve a proposal id to the local queue item (used only to confirm it exists before building). */
  resolveRef?: (cwd: string, ref: { id: string }) => Promise<ProposalQueueItem | null>;
  /** The four gated stage runners (default = the real cores). */
  stages?: StageRunners;
  cwd?: string;
}

/** Deepest-artifact precedence: a later (deeper) stage's artifact wins over an earlier one. */
function pickDeepest(stages: FactoryStageOutcome[]): string | null {
  // PIPELINE_ORDER is shallow→deep, so the LAST stage with a real artifact is the deepest.
  let deepest: string | null = null;
  for (const s of stages) if (s.artifact) deepest = s.artifact;
  return deepest;
}

/**
 * Run the build pass ONCE.
 *
 * - No spine DB configured ⇒ honest skip line.
 * - No approved agent spec ⇒ the exact PARTIAL no-op line, NO stage called.
 * - One approved spec ⇒ run scaffold→pr→data→runtime IN ORDER, each under its OWN gate; stop early on
 *   a HARD stage failure; never force production. Returns honest per-stage log lines.
 *
 * Returns the log lines (so the daemon/CLI can print them). The structured result is available via
 * runFactoryBuildPass for callers (e.g. the organ) that need the deepest artifact + failed flag.
 */
export async function runFactoryBuildOnce(
  env: NodeJS.ProcessEnv,
  now: string,
  deps: FactoryBuildPassDeps = {},
): Promise<string[]> {
  const r = await runFactoryBuildPass(env, now, deps);
  return r.lines;
}

/** Structured variant of the build pass (the organ reads .deepestArtifact / .failed / .proposalId). */
export async function runFactoryBuildPass(
  env: NodeJS.ProcessEnv,
  now: string,
  deps: FactoryBuildPassDeps = {},
): Promise<FactoryBuildPassResult> {
  const makeDb = deps.makeDb ?? createCockpitProposalDb;
  const resolveRef = deps.resolveRef ?? realResolveRef;
  const stages = deps.stages ?? realStageRunners;
  const cwd = deps.cwd ?? process.cwd();

  const empty: FactoryBuildPassResult = { proposalId: null, stages: [], deepestArtifact: null, failed: false, lines: [] };

  const handle = makeDb(env);
  if (!handle) {
    return { ...empty, lines: ["factory-build: no spine DB (HARTOS_SUPABASE_DB_URL) — nothing to build"] };
  }

  try {
    // THE SELECT — Hart-approved agent specs only. status='approved_for_execution' is the approval
    // floor; payload->>'actionType'='agent_creation_plan' restricts to buildable specs. limit 1 per
    // tick because a build is heavy. Mirrors the spine query style in scripts/hartos-runner.ts.
    const res = await handle.query(
      `select id from public.cockpit_proposals where status = $1 and payload->>'actionType' = $2 order by updated_at asc nulls last limit $3`,
      [BUILD_APPROVED_STATUS, BUILD_ACTION_TYPE, BUILD_MAX_PER_TICK],
    );
    const buildable = selectBuildableProposals(res.rows as Array<{ id?: unknown }>, BUILD_MAX_PER_TICK);

    if (buildable.length === 0) {
      return { ...empty, lines: ["factory-build: no approved agent spec — nothing to build"] };
    }

    const target = buildable[0]!;

    // Confirm the spec exists in the local queue the cores read (the spine is the selector; the cores
    // act on the local item + re-verify approval). Missing local item ⇒ honest skip, NOT a fake build.
    const item = await resolveRef(cwd, { id: target.id });
    if (!item) {
      return {
        ...empty,
        proposalId: target.id,
        lines: [`factory-build: approved spec ${target.id} not in the local queue — cannot build (the cores read the local item); skipped`],
      };
    }

    const lines: string[] = [`factory-build: building approved spec ${target.id} (${PIPELINE_ORDER.join(" → ")}); each stage under its own gate, staging-only.`];
    const outcomes: FactoryStageOutcome[] = [];
    let failed = false;

    // Run the pipeline IN ORDER. A stage that THROWS is a HARD failure → stop early (do not run the
    // deeper stages). A stage that returns (incl. a closed-gate dry-run) is honest progress → continue.
    for (const stage of PIPELINE_ORDER) {
      try {
        const r = await stages[stage](cwd, target.id, now, env);
        outcomes.push({ stage, ok: true, artifact: r.artifact, note: r.note });
        lines.push(`  • ${stage}: ${r.note}${r.artifact ? ` [artifact: ${r.artifact}]` : ""}`);
      } catch (e) {
        const msg = redact(e instanceof Error ? e.message : String(e));
        outcomes.push({ stage, ok: false, artifact: null, note: msg });
        lines.push(`  • ${stage}: HARD FAIL — ${msg}. Stopping the pipeline (deeper stages not run).`);
        failed = true;
        break; // early-stop on a hard failure
      }
    }

    const deepestArtifact = pickDeepest(outcomes);
    lines.push(
      failed
        ? `factory-build: pipeline stopped early on a stage failure. deepest artifact: ${deepestArtifact ?? "none"}.`
        : `factory-build: pipeline complete (gates honored). deepest artifact: ${deepestArtifact ?? "none — all stages dry-ran behind closed gates (honest)"}.`,
    );

    return { proposalId: target.id, stages: outcomes, deepestArtifact, failed, lines };
  } finally {
    await handle.close();
  }
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runFactoryBuildOnce(process.env, new Date().toISOString())
    .then((lines) => {
      console.log("\nHartOS — factory build pass (Hart-approved specs only; per-stage gates hold; staging-only)\n");
      for (const l of lines) console.log(l);
      console.log("");
    })
    .catch((e) => {
      console.error(`factory build pass failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
