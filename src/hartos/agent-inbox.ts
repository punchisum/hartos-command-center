/**
 * src/hartos/agent-inbox.ts — Factory Agent v1, capability 1: the Inbox triage.
 *
 * Plan §1 cap 1 + §16 + §17 step 2 (HARTOS_3_LEVELS_UP_MUTATION_MAP.md):
 *   "Inbox — receive build requests; classify buildable / too-vague / unsafe /
 *    already-solved (wire into cockpit-intent-router.ts as step 1)."
 *
 * This is the first gate of the Manifest-Driven Factory. It does NOT build anything.
 * It triages a raw build request into exactly one of four labels so the router can
 * refuse early (unsafe / vague), short-circuit (already-solved), or proceed to the
 * Spec Interrogator (buildable). It is a COMPOSER: it reads the existing
 * deterministic machinery (request-classifier, agent-planner, agent-contract) and
 * the §16 exclusion list — it owns no second vocabulary.
 *
 * Doctrine (matches agent-planner.ts):
 *   - PURE + deterministic. No node:fs, no pg, no network, no Supabase, no clock.
 *     Worker-safe (no node:fs anywhere in this module's import graph).
 *   - DEGRADE-SAFE. AGENT_CONTRACTS is authoritative-but-incomplete and hand-
 *     maintained; a no-match reads as "no known agent covers this" — NEVER "novel".
 *     This module NEVER mutates AGENT_CONTRACTS.
 *   - REFUSE FIRST. §16 unsafe exclusions take precedence over everything; a thin /
 *     generic build is itself a §16 exclusion (vague-but-unsafe stays unsafe).
 */

import { classifyRequest } from "./request-classifier.js";
import { buildAgentDraft } from "../cockpit/agent-planner/agent-planner.js";
import {
  AGENT_CONTRACTS,
  findAgentContract,
  type AgentContract,
} from "../agents/agent-contract.js";
import type { ClassifiedRequest, Domain } from "./orchestrator-types.js";
import type { ReadModelType } from "../read-models/read-model-types.js";

/** The four Inbox triage labels (these live ONLY here — not in request-classifier). */
export type InboxLabel = "buildable" | "too_vague" | "unsafe" | "already_solved";

/** The triage verdict the Factory Inbox emits for one build request. */
export interface InboxVerdict {
  label: InboxLabel;
  /** Honest, human-readable reasons for the label (never decorative). */
  reasons: string[];
  /** Questions to surface when the request is too vague to lock a spec. */
  clarifyingQuestions?: string[];
  /** When already_solved: the existing officiated agent (AgentContract.type) that covers it. */
  matchedAgent?: string;
  /** When unsafe: the exact §16 exclusion phrase that fired. */
  unsafeExclusion?: string;
  /** The underlying deterministic classification this verdict was derived from. */
  classification: ClassifiedRequest;
}

/**
 * §16 explicit exclusions, as keyword triggers. The `label` is the canonical §16
 * phrase carried into `unsafeExclusion`. Order matters only for which reason is
 * reported first; ALL matches are collected into `reasons`. Kept verbatim-aligned
 * with HARTOS_3_LEVELS_UP_MUTATION_MAP.md §16 — never weakened, never narrowed.
 */
interface UnsafeExclusion {
  label: string;
  keywords: string[];
}

const UNSAFE_EXCLUSIONS: UnsafeExclusion[] = [
  {
    label: "money movement",
    keywords: ["move money", "moves money", "moving money", "transfer money", "transfer funds", "send money", "sends money", "sending money", "send funds", "wire transfer", "make a payment", "make payments", "pay out", "payout", "withdraw funds", "execute a trade", "execute trades", "place an order", "banking transaction"],
  },
  { label: "Apple Health writes", keywords: ["write to apple health", "apple health write", "write apple health", "write healthkit", "healthkit write"] },
  { label: "Telegram-send adapter", keywords: ["telegram send", "telegram-send", "send telegram", "send a telegram", "send telegram message", "telegram sender"] },
  { label: "Drive mutation (no typed gated adapter)", keywords: ["mutate drive", "modify google drive", "write to google drive", "delete from drive", "edit google drive files"] },
  { label: "arbitrary natural-language execution", keywords: ["execute arbitrary", "arbitrary command", "run any command", "execute any natural language", "run whatever i say", "execute whatever", "arbitrary code execution"] },
  { label: "auto-merge", keywords: ["auto-merge", "auto merge", "automatically merge", "merge automatically", "auto-approve and merge"] },
  { label: "auto-deploy without gate", keywords: ["auto-deploy", "auto deploy", "deploy automatically", "automatically deploy", "deploy without approval", "deploy without a gate"] },
  { label: "voice approval", keywords: ["approve by voice", "voice approval", "approve with my voice", "voice-approve", "approve via voice"] },
  { label: "broad autonomy", keywords: ["fully autonomous", "full autonomy", "broad autonomy", "act on its own", "without human approval", "no human in the loop", "act autonomously"] },
  { label: "delete actions", keywords: ["delete all", "delete every", "delete records", "delete the records", "delete data", "delete everything", "bulk delete", "purge all", "wipe all", "wipe the database", "drop the table", "drop tables"] },
  { label: "bulk external mutation", keywords: ["bulk update", "bulk external", "mass update", "mass-update", "update all external", "bulk mutate", "mass mutate"] },
  { label: "blind dependency import", keywords: ["import any dependency", "blindly import", "auto-import dependencies", "install any package", "import whatever dependency", "pull in any library"] },
  { label: "raw codegen outside the Escalation Policy", keywords: ["write arbitrary code", "generate raw code", "raw codegen", "write any code", "freeform code generation", "autonomous coder", "write whatever code"] },
];

/**
 * Map the classifier's `Domain` to the `ReadModelType` keyspace that the STATIC
 * AGENT_CONTRACTS literal is keyed on. ONLY domains that correspond to a real
 * officiated read-model resolve; everything else returns undefined ⇒ deferred to the
 * created-contract reach below (NOT an immediate "no agent covers this"). This is
 * NOT a claim that the request is novel — the officiation registry is incomplete.
 */
function domainToReadModelType(domain: Domain): ReadModelType | undefined {
  switch (domain) {
    case "fitness":
      return "fitness";
    case "ops":
      return "ops";
    default:
      // finance/tax/engineering/research/personal_os/command_center/unknown have no
      // STATICALLY-keyed read-model agent — they fall through to matchCreatedContract,
      // which can still reach a CREATED contract by its self-declared identity.
      return undefined;
  }
}

/**
 * Tokenize a string into lowercased, alphanumeric words ≥ 3 chars. Used to compare a
 * created contract's self-declared identity against the request words. Short tokens are
 * dropped so a contract can't match on noise like "ui"/"id"/"a".
 */
function identityTokens(...sources: string[]): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    for (const tok of (s || "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length >= 3) out.add(tok);
    }
  }
  return [...out];
}

/**
 * Reach a CREATED contract whose NOVEL domain the static fitness/ops map can't key.
 *
 * The static `domainToReadModelType` only resolves fitness/ops; every other classifier
 * domain returns undefined, so a created agent's contract (a novel read-model `type`
 * such as "other" — composed into `contracts` via resolveKnownAgents) was carried in but
 * UNREACHABLE at the match step. This closes that: it scans ONLY the supplied
 * non-fitness/ops contracts and matches one whose own declared identity tokens
 * (label / readModelId / type / generic detail domain+label) appear in the request.
 *
 * Deterministic + degrade-safe: a contract joins only by its OWN self-declared words
 * appearing verbatim in the request — never a guess, never novelty. The static
 * fitness/ops contracts are intentionally skipped here (they already match through
 * `domainToReadModelType`), so this NEVER changes fitness/ops behaviour. First match in
 * `contracts` order wins (stable: resolveKnownAgents preserves a stable order).
 */
function matchCreatedContract(request: string, contracts: AgentContract[]): AgentContract | undefined {
  const reqTokens = new Set(identityTokens(request));
  const STATIC_TYPES = new Set<ReadModelType>(["fitness", "ops"]);
  for (const c of contracts) {
    // Skip the statically-keyed agents — their reach is the fitness/ops map above.
    if (STATIC_TYPES.has(c.type)) continue;
    const detail = c.detail;
    const detailWords = "kind" in detail ? [] : [detail.domain, detail.label];
    const tokens = identityTokens(c.label, c.readModelId, c.type, ...detailWords);
    if (tokens.length === 0) continue;
    if (tokens.some((t) => reqTokens.has(t))) return c;
  }
  return undefined;
}

/** Collect every §16 exclusion the request trips (precedence order preserved). */
function matchUnsafeExclusions(request: string): UnsafeExclusion[] {
  const t = request.toLowerCase();
  return UNSAFE_EXCLUSIONS.filter((ex) => ex.keywords.some((k) => t.includes(k)));
}

export interface ClassifyBuildRequestOptions {
  /** Override the officiation registry (tests inject a fixture). Defaults to AGENT_CONTRACTS. */
  contracts?: AgentContract[];
}

/**
 * Triage one build request into exactly one InboxLabel.
 *
 * PRECEDENCE (refuse first, never launder):
 *   1. unsafe          — trips a §16 exclusion keyword (incl. generic/thin builds).
 *   2. already_solved  — the request's domain resolves to an existing AGENT_CONTRACTS
 *                        entry (degrade-safe: a no-match is "not yet covered", not "novel").
 *   3. too_vague       — the classifier read it as 'unknown' classification / 'generic'
 *                        build target (no concrete target to interrogate toward). The
 *                        planner draft's still-missing fields become the clarifying
 *                        questions. A request WITH a concrete target that merely lacks
 *                        answers is 'buildable' — interrogation-pending is not rejection.
 *   4. buildable       — otherwise.
 *
 * Pure + deterministic: same request + same contracts ⇒ deep-equal verdict.
 */
export function classifyBuildRequest(
  request: string,
  opts: ClassifyBuildRequestOptions = {},
): InboxVerdict {
  const contracts = opts.contracts ?? AGENT_CONTRACTS;
  const classification = classifyRequest(request);

  // ── 1. UNSAFE — §16 exclusions win over everything (a thin/generic build is unsafe). ──
  const unsafe = matchUnsafeExclusions(request);
  if (unsafe.length > 0) {
    return {
      label: "unsafe",
      reasons: unsafe.map((ex) => `Refused — matches the §16 exclusion: ${ex.label}.`),
      unsafeExclusion: unsafe[0]!.label,
      classification,
    };
  }

  // ── 2. ALREADY_SOLVED — an existing officiated agent already covers this request. ──
  // First the statically-keyed fitness/ops path (unchanged). If that doesn't resolve,
  // reach a CREATED contract by its own self-declared identity — so a novel-domain agent
  // composed into `contracts` (via resolveKnownAgents) is no longer carried-but-unreachable.
  const rmType = domainToReadModelType(classification.domain);
  const match =
    (rmType ? findAgentContract(rmType, contracts) : undefined) ??
    matchCreatedContract(request, contracts);
  if (match) {
    return {
      label: "already_solved",
      reasons: [
        `An existing officiated agent already covers the ${classification.domain} domain: "${match.label}" (${match.type}). Extend it rather than building a new agent.`,
      ],
      matchedAgent: match.type,
      classification,
    };
  }

  // ── 3. TOO_VAGUE — a weak/generic classifier signal (no concrete target to lock). ──
  // The planner draft supplies the clarifying questions for the fields still missing.
  // A request with a CONCRETE target that merely lacks answers is buildable (it is
  // worth interrogating) — interrogation-pending ≠ too vague to start.
  const draft = buildAgentDraft(request);
  const weakSignal =
    classification.classification === "unknown" || classification.buildTarget === "generic";
  if (weakSignal) {
    const reasons: string[] = [];
    if (classification.classification === "unknown") {
      reasons.push("Request did not match a known build pattern — too vague to lock a spec.");
    }
    if (classification.buildTarget === "generic") {
      reasons.push("No specific build target detected (generic) — needs a sharper, measurable spec.");
    }
    if (draft.missingFields.length > 0) {
      reasons.push(
        `Requirements incomplete — still missing: ${draft.missingFields.join(", ")}. The Factory refuses to build from vague intent.`,
      );
    }
    return {
      label: "too_vague",
      reasons,
      clarifyingQuestions: draft.clarifyingQuestions,
      classification,
    };
  }

  // ── 4. BUILDABLE — passes the gate; hand off to the Spec Interrogator. ──
  return {
    label: "buildable",
    reasons: [
      `No §16 exclusion tripped, no existing agent covers the ${classification.domain} domain, and the request is specific enough to interrogate into a spec.`,
    ],
    classification,
  };
}
