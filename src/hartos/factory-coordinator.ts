// src/hartos/factory-coordinator.ts
// Wires the pure Factory pieces (Inbox → Interrogator → Compiler → Planner) into a
// single gated AgentJob lifecycle coordinator. The coordinator is PURE: no node:fs,
// no pg, no network, no Supabase, no ambient clock. All side-effectful providers
// (Beezulbub scout) are injected via opts — never imported directly.

import { classifyBuildRequest } from "./agent-inbox.js";
import type { InboxVerdict } from "./agent-inbox.js";
import { assessSpecReadiness } from "./spec-interrogator.js";
import type { SpecReadinessResult } from "./spec-interrogator.js";
import { compileSpecToManifest, validateManifest } from "./manifest-compiler.js";
import type { ManifestViolation } from "./manifest-types.js";
import { planFromManifest } from "./manifest-build-planner.js";
import type { ImplementationPlan } from "./manifest-build-planner.js";
import type { AgentSpec, AgentManifest } from "./manifest-types.js";
import type { InterrogationAnswer } from "../research/agent-job-types.js";
import type { BeezulbubCapabilityReport } from "../beezulbub/types.js";

export type FactoryJobStatus =
  | "inbox"
  | "interrogating"
  | "spec_ready"
  | "manifest_compiled"
  | "planned"
  | "awaiting_approval"
  | "refused"
  | "archived";

export interface FactoryJobState {
  jobId: string;
  status: FactoryJobStatus;
  requestText: string;
  verdict?: InboxVerdict;
  interrogation?: SpecReadinessResult;
  answers?: InterrogationAnswer[];
  spec?: AgentSpec;
  manifest?: AgentManifest;
  violations?: ManifestViolation[];
  plan?: ImplementationPlan;
  beezulbubReport?: BeezulbubCapabilityReport;
  repair?: never; // RepairProposal slot — unused at coordinator level (repair loop is post-build)
  refusalReason?: string;
  proposedAt?: string;
}

export interface StartFactoryJobOptions {
  now?: string;
  scoutProvider?: (specId: string, text: string) => Promise<BeezulbubCapabilityReport>;
}

export interface FactoryJobAdvanceInput {
  answers?: InterrogationAnswer[];
  approved?: boolean;
  scoutProvider?: (specId: string, text: string) => Promise<BeezulbubCapabilityReport>;
}

export interface AdvanceFactoryJobOptions {
  now?: string;
}

// Stable counter for deterministic jobId generation (no Math.random, no ambient clock).
// Resets per module load — callers that need persistence must carry the state themselves.
let _jobCounter = 0;

function makeJobId(requestText: string): string {
  _jobCounter += 1;
  // Combine a stable counter with a simple content fingerprint (first 32 chars, sanitised).
  const slug = requestText.trim().slice(0, 32).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `job-${_jobCounter}-${slug}`;
}

/**
 * Classify a build request and start an AgentJob:
 *   - unsafe / too_vague → refused immediately (terminal).
 *   - already_solved     → short-circuit to awaiting_approval (existing agent covers it).
 *   - buildable          → interrogate and return interrogating state.
 *
 * Never throws. Returns a refused state for any invalid or rejected input.
 */
export function startFactoryJob(
  requestText: string,
  opts: StartFactoryJobOptions = {},
): FactoryJobState {
  const jobId = makeJobId(requestText);
  const base: FactoryJobState = { jobId, status: "inbox", requestText };

  // Guard: empty/blank request is refused immediately.
  if (!requestText || !requestText.trim()) {
    return {
      ...base,
      status: "refused",
      refusalReason: "Empty or blank build request — nothing to classify.",
    };
  }

  const verdict = classifyBuildRequest(requestText);
  const withVerdict: FactoryJobState = { ...base, verdict };

  if (verdict.label === "unsafe") {
    return {
      ...withVerdict,
      status: "refused",
      refusalReason: verdict.reasons.join(" "),
    };
  }

  if (verdict.label === "too_vague") {
    return {
      ...withVerdict,
      status: "refused",
      refusalReason: verdict.reasons.join(" "),
    };
  }

  if (verdict.label === "already_solved") {
    // Short-circuit: an existing officiated agent already covers this; surface for Hart.
    return {
      ...withVerdict,
      status: "awaiting_approval",
      proposedAt: opts.now,
      refusalReason: verdict.reasons.join(" "),
    };
  }

  // buildable — run the Spec Interrogator (no answers yet, so verdict is NEEDS_INTERROGATION).
  const interrogation = assessSpecReadiness(requestText, [], { now: opts.now });

  return {
    ...withVerdict,
    status: "interrogating",
    interrogation,
    answers: [],
  };
}

/**
 * Advance the state machine one step given the current state and input from Hart.
 *
 * Transitions:
 *   interrogating + answers → spec_ready  (when assessSpecReadiness yields SPEC_READY)
 *                          → interrogating (still needs more answers)
 *   spec_ready + approved  → manifest_compiled (compile + validate)
 *   manifest_compiled      → planned (planFromManifest; optional scout enrichment sync-only)
 *   planned + approved     → awaiting_approval
 *   refused                → refused (terminal; no-op)
 *   awaiting_approval      → awaiting_approval (terminal pending Hart; no-op)
 *   any other terminal     → same state (no-op)
 *
 * Never throws. Returns a refused state instead of propagating errors.
 * Never self-approves: approved:true in input is required to leave spec_ready/planned.
 */
export function advanceFactoryJob(
  state: FactoryJobState,
  input: FactoryJobAdvanceInput,
  opts: AdvanceFactoryJobOptions = {},
): FactoryJobState {
  // Terminal states are no-ops.
  if (state.status === "refused" || state.status === "archived" || state.status === "awaiting_approval") {
    return state;
  }

  if (state.status === "interrogating") {
    const answers = input.answers ?? state.answers ?? [];
    const interrogation = assessSpecReadiness(state.requestText, answers, { now: opts.now });

    if (interrogation.readiness === "REFUSE_VAGUE" || interrogation.readiness === "REFUSE_GENERIC") {
      return {
        ...state,
        status: "refused",
        answers,
        interrogation,
        refusalReason: interrogation.reason,
      };
    }

    if (interrogation.readiness === "SPEC_READY" || interrogation.readiness === "NEEDS_RISK_REVIEW") {
      // SPEC_READY: all dimensions locked, advance.
      // NEEDS_RISK_REVIEW: fully interrogated but strategy risk is high; surface the risk
      // in interrogation.reason — Hart still approves the spec before manifest compilation.
      const spec = deriveSpecFromInterrogation(state.requestText, interrogation, answers);
      return {
        ...state,
        status: "spec_ready",
        answers,
        interrogation,
        spec,
      };
    }

    // Still interrogating (NEEDS_INTERROGATION or NEEDS_RISK_REVIEW).
    return { ...state, status: "interrogating", answers, interrogation };
  }

  if (state.status === "spec_ready") {
    if (!input.approved) {
      // Awaiting Hart's approval — no change.
      return state;
    }
    if (!state.spec) {
      return {
        ...state,
        status: "refused",
        refusalReason: "Cannot compile manifest: no locked spec on state.",
      };
    }
    const manifest = compileSpecToManifest(state.spec);
    const violations = validateManifest(manifest);
    return {
      ...state,
      status: "manifest_compiled",
      manifest,
      violations,
    };
  }

  if (state.status === "manifest_compiled") {
    if (!state.manifest) {
      return {
        ...state,
        status: "refused",
        refusalReason: "Cannot plan: no manifest on state.",
      };
    }
    // scoutProvider is sync-call-impossible (async), so we carry the report only if
    // it was already attached (pre-fetched). The coordinator is pure/sync — callers
    // that need async scout enrichment must resolve it before calling advanceFactoryJob.
    const plan = planFromManifest(state.manifest, { report: state.beezulbubReport, now: opts.now });
    return {
      ...state,
      status: "planned",
      plan,
    };
  }

  if (state.status === "planned") {
    if (!input.approved) {
      return state;
    }
    return {
      ...state,
      status: "awaiting_approval",
      proposedAt: opts.now,
    };
  }

  // inbox status: re-run startFactoryJob logic is not in scope of advance; no-op.
  return state;
}

// ─── internal helpers ──────────────────────────────────────────────────────────

import type { ReadModelType } from "../read-models/read-model-types.js";

/**
 * Derive a minimal AgentSpec from a SPEC_READY interrogation result.
 *
 * This is a structural projection, not invention: every field is derived from the
 * interrogation's locked data (domain, request, answers). Undeclared fields default
 * to honest empty-but-safe values — never fabricated capabilities or criteria.
 * In production callers would supply a fully-formed spec; this covers the coordinator's
 * own state-machine path where no external spec is injected.
 */
function deriveSpecFromInterrogation(
  requestText: string,
  interrogation: SpecReadinessResult,
  answers: InterrogationAnswer[],
): AgentSpec {
  const domain = interrogation.classification.domain;
  const specId = `spec-${domain}-${requestText.trim().slice(0, 20).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const agentName = `${domain}-agent`;

  // Map domain → a known ReadModelType; unknown domains fall back to "other".
  const targetReadModelType: ReadModelType =
    domain === "fitness" || domain === "ops" ? domain : "other" as ReadModelType;

  const answerMap = new Map(answers.map((a) => [a.questionId, a.answer]));

  return {
    specId,
    agentName,
    domain,
    targetReadModelType,
    purpose: requestText.trim().slice(0, 200),
    dataSources: [answerMap.get("read_source") ?? "unspecified"],
    capabilities: [answerMap.get("output") ?? "unspecified"],
    label: agentName,
    icon: "agent",
    proposalTypes: [answerMap.get("proposal_type") ?? "proposal"],
    outputs: [],
    jobType: "monitoring",
    boundary: { stopConditions: [] },
    acceptanceCriteria: [answerMap.get("measurable_acceptance_criteria") ?? "unspecified"],
    riskLevel: interrogation.strategy.risk ?? "medium",
    prereqs: [],
    cockpitDone: true,
    approvalRequired: true,
    failureMode: answerMap.get("failure_mode") ?? "unspecified",
  };
}
