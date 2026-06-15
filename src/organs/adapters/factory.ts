/**
 * src/organs/adapters/factory.ts — the Factory organ adapter.
 *
 * INTERROGATE-ONLY readiness check. The Factory's real authority is to compile a spec and
 * (eventually) scaffold/build an agent — but CONSTRAINT #8 forbids ANY external execution
 * from this adapter: no scaffold, no build, no file write, no PR, no push, no deploy. So this
 * adapter does the one thing it CAN do with zero side-effects: it confirms the SPEC
 * INTERROGATION pipeline is callable.
 *
 * Entrypoint = interrogateSpec (src/hartos/spec-interrogator.ts) — a PURE, deterministic
 * "manifest compiler" front-door that GRILLS a build request into a fixed question set (the
 * five spec-lock dimensions + measurable acceptance criteria + domain questions) BEFORE any
 * spec is locked. Interrogating a trivial sample request is a genuine, side-effect-free probe:
 * a real question set proves the pipeline is wired and importable.
 *
 * Doctrine: status DERIVED from evidence; NEVER fake ok:true. Because build/deploy is disarmed
 * (#8) and there is no real, Hart-approved spec to lock, a callable interrogator is NOT a
 * completed factory run — it is an HONEST PARTIAL. So ok:false is the truthful verdict even
 * when the pipeline works: "factory interrogate-ready; build/deploy disarmed (#8)". outputRef
 * is a questions handle when an interrogation question set is produced, else null. Any throw is
 * captured as an honest ok:false (broken pipeline, not disarmed). Thin: it calls the existing
 * pure fn, reimplements nothing, and adds no external/build side-effects.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { interrogateSpec } from "../../hartos/spec-interrogator.js";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

/**
 * A trivial, concrete sample request used ONLY to exercise the interrogator. It is never
 * locked, never built, never persisted — it exists solely so the pure pipeline returns a real
 * question set we can count as readiness evidence.
 */
const SAMPLE_SPEC_REQUEST =
  "monitor a service and alert when its error rate crosses a threshold";

export const factoryOrgan: OrganAdapter = {
  organId: "factory",
  armingFlag: "ALLOW_CODE_BUILD",
  async run(_env: NodeJS.ProcessEnv, _now: string): Promise<OrganRunResult> {
    try {
      // INTERROGATE-ONLY probe. interrogateSpec() is pure + deterministic with zero side
      // effects (no fs, no net, no clock) — it just compiles the request into a question set.
      // NOTHING is scaffolded, built, written, or deployed here (#8).
      const interrogation = interrogateSpec(SAMPLE_SPEC_REQUEST);
      const questionCount = interrogation.questions.length;
      const dimensionCount = interrogation.dimensionIds.length;

      // A callable interrogator that returns required questions is the evidence — but it is
      // ONLY interrogate-readiness, not a completed build. So this is an HONEST PARTIAL:
      // ok:false even though the pipeline works, because build/deploy is disarmed (#8).
      const pipelineReady = questionCount > 0 && dimensionCount > 0;
      const outputRef = pipelineReady ? `questions:${questionCount}` : null;

      return {
        ok: false,
        outputRef,
        summary: cap(
          pipelineReady
            ? "factory interrogate-ready; build/deploy disarmed (#8)"
            : "factory interrogate pipeline returned no questions; build/deploy disarmed (#8)",
        ),
        detail: {
          partial: true,
          interrogateReady: pipelineReady,
          questionCount,
          dimensionCount,
          measurableCriteriaQuestionId: interrogation.measurableCriteriaQuestionId,
          // Why this is honestly NOT ok:true: no real spec, and external execution is forbidden.
          disarmedReason:
            "INTERROGATE-ONLY (#8): no scaffold/build/write/PR/deploy; no Hart-approved spec to lock.",
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`factory interrogate probe failed: ${msg}`) };
    }
  },
};
