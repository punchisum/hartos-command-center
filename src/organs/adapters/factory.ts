/**
 * src/organs/adapters/factory.ts — the Factory organ adapter.
 *
 * BUILD-AFTER-APPROVAL. The Factory's job is now to build a Hart-APPROVED agent spec by SEQUENCING
 * the existing gated build cores (scaffold 18A → PR 18B → data-provision 18C → runtime 18D). It adds
 * NO new authority: the dedicated pass (scripts/run-factory-build-pass.ts) drives the cores, each of
 * which enforces its OWN gate, re-checks the approval floor (status=approved_for_execution, Key 1),
 * hard-refuses production, deploys staging-only (*.workers.dev), and secret-scans. This adapter is a
 * THIN summary of that pass for the organ-supervisor's evidence row.
 *
 * Arming: ALLOW_LOCAL_SCAFFOLD — the ENTRY gate for building (18A's Key 2). The organ is "armed to
 * build" only when a real scaffold write is permitted; disarmed ⇒ the supervisor writes an honest
 * skip beat (it never even calls run()). NOTE: the dedicated daemon pass is what actually drives
 * builds with full per-stage logging; this adapter just reflects the pass into the organ evidence.
 *
 * Doctrine: status DERIVED from evidence; NEVER fake ok:true.
 *   - ok:true  + outputRef = the DEEPEST real artifact (deployed worker > PR url > scaffold path)
 *              ONLY when a real stage produced one.
 *   - ok:false (PARTIAL) with no outputRef when there was no approved spec to build (honest no-op).
 *   - ok:false on a stage hard-failure (the supervisor still records errored=false ⇒ PARTIAL; a
 *              thrown adapter would be errored=true ⇒ FAILED — we don't throw for an honest no-op).
 *
 * The interrogate capability is kept available as a trivial side-effect-free fallback ONLY when the
 * build pass can't run (no spine DB), so the organ still proves the spec pipeline is importable.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { runFactoryBuildPass } from "../../../scripts/run-factory-build-pass.js";
import { interrogateSpec } from "../../hartos/spec-interrogator.js";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

/** A trivial, never-built sample request used ONLY to prove the interrogator is importable (fallback). */
const SAMPLE_SPEC_REQUEST = "monitor a service and alert when its error rate crosses a threshold";

export const factoryOrgan: OrganAdapter = {
  organId: "factory",
  // Armed to BUILD only when a real scaffold write is permitted (18A entry gate / Key 2). The deeper
  // stages (PR/data/runtime) each gate themselves further; this is just the organ's arming threshold.
  armingFlag: "ALLOW_LOCAL_SCAFFOLD",
  async run(env: NodeJS.ProcessEnv, now: string): Promise<OrganRunResult> {
    try {
      const pass = await runFactoryBuildPass(env, now);
      const last = pass.lines[pass.lines.length - 1] ?? "factory-build pass produced no output";

      // No spine DB at all → fall back to the side-effect-free interrogate probe so the organ still
      // proves the spec pipeline is importable. Honest PARTIAL (interrogate-ready, not a build).
      if (pass.lines.some((l) => l.includes("no spine DB"))) {
        const interrogation = interrogateSpec(SAMPLE_SPEC_REQUEST);
        const ready = interrogation.questions.length > 0 && interrogation.dimensionIds.length > 0;
        return {
          ok: false,
          outputRef: ready ? `questions:${interrogation.questions.length}` : null,
          summary: cap("factory: no spine DB — interrogate-ready, no approved spec to build (PARTIAL)"),
          detail: { partial: true, mode: "interrogate-fallback", interrogateReady: ready, build: last },
        };
      }

      // A stage HARD-failed → honest ok:false (FAILED downstream is reserved for thrown adapters;
      // this is a recorded failure surfaced as ok:false with the deepest artifact reached).
      if (pass.failed) {
        return {
          ok: false,
          outputRef: pass.deepestArtifact, // surface how far it got, if anything real was produced
          summary: cap(`factory build stopped on a stage failure: ${last}`),
          detail: { mode: "build", proposalId: pass.proposalId, failed: true, stages: pass.stages },
        };
      }

      // A real stage produced a real artifact (deployed worker > PR url > scaffold path) → ok:true.
      if (pass.deepestArtifact) {
        return {
          ok: true,
          outputRef: pass.deepestArtifact,
          summary: cap(`factory built spec ${pass.proposalId}: ${last}`),
          detail: { mode: "build", proposalId: pass.proposalId, failed: false, stages: pass.stages },
        };
      }

      // Nothing buildable, OR every stage honestly dry-ran behind a closed gate → PARTIAL no-op.
      const builtNothing = pass.proposalId == null;
      return {
        ok: false,
        outputRef: null,
        summary: cap(
          builtNothing
            ? "factory: no approved spec to build (PARTIAL)"
            : `factory: spec ${pass.proposalId} dry-ran behind closed gates — nothing live yet (PARTIAL)`,
        ),
        detail: { partial: true, mode: "build", proposalId: pass.proposalId, stages: pass.stages, build: last },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`factory build pass failed: ${msg}`) };
    }
  },
};
