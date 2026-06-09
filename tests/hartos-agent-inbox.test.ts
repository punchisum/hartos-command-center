/**
 * tests/hartos-agent-inbox.test.ts — Factory Agent v1, Inbox triage (plan §1 cap 1, §16, §17 step 2).
 *
 * The PURE four-label Inbox classifier: it triages a raw build request into exactly one of
 * buildable / too_vague / unsafe / already_solved by composing the request-classifier,
 * the agent-planner draft, the agent-contract officiation registry, and the §16 exclusion
 * list. Tests assert the four labels, the refuse-first precedence (unsafe > already_solved
 * > too_vague > buildable), the degrade-safe already_solved wording (a no-match reads as
 * "no known agent covers this", never "novel"), and determinism. Fully HERMETIC: pure
 * function of the request string — no env, no network, no fs, no clock.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyBuildRequest, type InboxVerdict } from "../src/hartos/agent-inbox.js";
import { AGENT_CONTRACTS, type AgentContract } from "../src/agents/agent-contract.js";
import { resolveKnownAgents } from "../src/agents/known-agent-registry.js";

// A valid CREATED agent for a NOVEL domain (type "other" — not fitness/ops, the only
// statically-keyed types). Built from the same shape as known-agent-registry.test.ts so
// it passes validateAgentContract (non-empty proposalTypes + generic detail with rpcs +
// columns). Its self-declared identity word "receipt" is how a build request for that
// domain reaches it — the gap this wave closes. The token is the singular "receipt" so
// it overlaps the classifier's receipt build-target requests verbatim.
const CREATED_RECEIPT: AgentContract = {
  type: "other",
  label: "Receipt Vault",
  icon: "🧾",
  readModelId: "receipt",
  proposalTypes: ["receipt_followup_plan"],
  approvalRequired: true,
  detail: {
    domain: "other",
    label: "Receipt Vault",
    urlEnv: "RECEIPT_URL",
    keyEnv: "RECEIPT_KEY",
    rpcs: [
      {
        rpc: "receipt_overview",
        section: "Outstanding",
        render: "table",
        columns: [{ header: "Receipt", field: "id" }],
      },
    ],
  },
};

describe("factory agent inbox — four-label triage (§1 cap 1, §16)", () => {
  it("'build a fitness tracker agent' → already_solved (fitness matches FITNESS_CONTRACT)", () => {
    const v = classifyBuildRequest("build a fitness tracker agent");
    assert.equal(v.label, "already_solved");
    assert.equal(v.matchedAgent, "fitness");
    assert.equal(v.classification.domain, "fitness");
    assert.ok(v.reasons.length > 0);
    // It points Hart at the existing agent rather than building a duplicate.
    assert.ok(v.reasons.some((r) => /existing officiated agent/i.test(r)));
  });

  it("'build an agent' (no domain/commands) → too_vague + clarifyingQuestions", () => {
    const v = classifyBuildRequest("build an agent");
    assert.equal(v.label, "too_vague");
    assert.ok(Array.isArray(v.clarifyingQuestions));
    assert.ok((v.clarifyingQuestions?.length ?? 0) > 0);
    assert.ok(v.reasons.length > 0);
    // generic build target is the weak signal that keeps it out of 'buildable'.
    assert.equal(v.classification.buildTarget, "generic");
  });

  it("'build an agent that moves money' → unsafe naming the §16 exclusion (money movement)", () => {
    const v = classifyBuildRequest("build an agent that moves money");
    assert.equal(v.label, "unsafe");
    assert.equal(v.unsafeExclusion, "money movement");
    assert.ok(v.reasons.some((r) => /money movement/i.test(r)));
  });

  it("'delete all records' → unsafe naming the §16 exclusion (delete actions)", () => {
    const v = classifyBuildRequest("delete all records");
    assert.equal(v.label, "unsafe");
    assert.equal(v.unsafeExclusion, "delete actions");
    assert.ok(v.reasons.some((r) => /delete actions/i.test(r)));
  });

  it("'build a tax specialist agent' → buildable (tax not in AGENT_CONTRACTS)", () => {
    const v = classifyBuildRequest("build a tax specialist agent");
    assert.equal(v.label, "buildable");
    assert.equal(v.classification.domain, "tax");
    assert.equal(v.classification.buildTarget, "tax_specialist");
    // no existing agent matched, but it is NOT flagged unsafe/vague.
    assert.equal(v.matchedAgent, undefined);
    assert.equal(v.unsafeExclusion, undefined);
  });

  it("unsafe takes precedence over too_vague (a thin/vague request that is also unsafe stays unsafe)", () => {
    // No domain, no target ⇒ would be too_vague on its own, but it asks for an unsafe action.
    const v = classifyBuildRequest("build an agent to delete all records");
    assert.equal(v.label, "unsafe");
    assert.equal(v.unsafeExclusion, "delete actions");
    // it does NOT degrade to a vague verdict despite missing requirements.
    assert.notEqual(v.label, "too_vague");
  });

  it("unsafe takes precedence over already_solved (an unsafe ops/fitness request stays unsafe)", () => {
    // fitness domain WOULD match FITNESS_CONTRACT, but money-movement fires first.
    const v = classifyBuildRequest("build a fitness agent that sends money to my coach");
    assert.equal(v.label, "unsafe");
    assert.equal(v.unsafeExclusion, "money movement");
  });

  it("degrade-safe: a no-match reads as 'no known agent covers this', NOT 'novel'", () => {
    const v = classifyBuildRequest("build a tax specialist agent");
    assert.equal(v.label, "buildable");
    const joined = v.reasons.join(" ").toLowerCase();
    // honest wording: incompleteness of AGENT_CONTRACTS, never a novelty claim.
    assert.ok(/no existing agent covers|no known agent/.test(joined));
    assert.ok(!/\bnovel\b/.test(joined));
  });

  it("degrade-safe: an unknown contracts fixture never mutates AGENT_CONTRACTS and never claims novelty", () => {
    const before = AGENT_CONTRACTS.length;
    // Inject an EMPTY registry — even fitness must read as not-yet-covered, not novel.
    const empty: AgentContract[] = [];
    const v = classifyBuildRequest("build a fitness tracker agent", { contracts: empty });
    assert.notEqual(v.label, "already_solved"); // no contract to match against
    assert.equal(AGENT_CONTRACTS.length, before); // registry untouched
    assert.ok(!/\bnovel\b/.test(v.reasons.join(" ").toLowerCase()));
  });

  it("opts.contracts override resolves already_solved against the injected registry", () => {
    // A fixture that DOES contain fitness still matches via the injected registry.
    const fixture = AGENT_CONTRACTS.filter((c) => c.type === "fitness");
    const v = classifyBuildRequest("build a fitness tracker agent", { contracts: fixture });
    assert.equal(v.label, "already_solved");
    assert.equal(v.matchedAgent, "fitness");
  });

  it("carries the underlying ClassifiedRequest on every verdict", () => {
    const labels: InboxVerdict[] = [
      classifyBuildRequest("build a fitness tracker agent"),
      classifyBuildRequest("build an agent"),
      classifyBuildRequest("build an agent that moves money"),
      classifyBuildRequest("build a tax specialist agent"),
    ];
    for (const v of labels) {
      assert.ok(v.classification);
      assert.equal(typeof v.classification.classification, "string");
      assert.ok(Array.isArray(v.classification.rationale));
    }
  });

  it("NEW REACH: a created contract for a NOVEL domain makes that domain classify already_solved", () => {
    // "build a receipt tracking agent" → domain finance / buildTarget receipt_agent — NOT
    // a static fitness/ops key, so domainToReadModelType can't reach it. With the created
    // Receipt Vault contract composed in, the created-contract reach matches it by its own
    // declared identity token ("receipt").
    const v = classifyBuildRequest("build a receipt tracking agent", {
      contracts: resolveKnownAgents([CREATED_RECEIPT]),
    });
    assert.equal(v.label, "already_solved");
    assert.equal(v.matchedAgent, "other"); // the created contract's read-model type
    assert.ok(v.reasons.some((r) => /existing officiated agent/i.test(r)));
    assert.ok(v.reasons.some((r) => /Receipt Vault/.test(r))); // points Hart at the created agent by label
  });

  it("NEW REACH: the SAME novel request without the created contract still classifies buildable", () => {
    // Identical request, but only the static AGENT_CONTRACTS (no Receipt Vault) — the reach
    // finds nothing, so it is honestly not-yet-covered, NOT already_solved or novel.
    const v = classifyBuildRequest("build a receipt tracking agent");
    assert.notEqual(v.label, "already_solved");
    assert.equal(v.matchedAgent, undefined);
    assert.equal(v.label, "buildable"); // receipt_agent is a concrete target — not too_vague
    assert.ok(!/\bnovel\b/.test(v.reasons.join(" ").toLowerCase()));
  });

  it("NEW REACH: passing the created contract directly via opts.contracts also matches (no resolve needed)", () => {
    const v = classifyBuildRequest("build a receipt tracking agent", {
      contracts: [...AGENT_CONTRACTS, CREATED_RECEIPT],
    });
    assert.equal(v.label, "already_solved");
    assert.equal(v.matchedAgent, "other");
  });

  it("REGRESSION: fitness still classifies already_solved against the static contracts (unchanged)", () => {
    const v = classifyBuildRequest("build a fitness tracker agent");
    assert.equal(v.label, "already_solved");
    assert.equal(v.matchedAgent, "fitness");
    // Adding a created contract must NOT change the static fitness match.
    const v2 = classifyBuildRequest("build a fitness tracker agent", {
      contracts: resolveKnownAgents([CREATED_RECEIPT]),
    });
    assert.equal(v2.label, "already_solved");
    assert.equal(v2.matchedAgent, "fitness");
  });

  it("REGRESSION: ops still classifies already_solved against the static contracts (unchanged)", () => {
    const v = classifyBuildRequest("monitor operations uptime and deployment status");
    assert.equal(v.label, "already_solved");
    assert.equal(v.matchedAgent, "ops");
    const v2 = classifyBuildRequest("monitor operations uptime and deployment status", {
      contracts: resolveKnownAgents([CREATED_RECEIPT]),
    });
    assert.equal(v2.label, "already_solved");
    assert.equal(v2.matchedAgent, "ops");
  });

  it("REGRESSION: unsafe precedence still wins even when a created contract would otherwise match", () => {
    // The request's identity token ("receipt") WOULD match the created contract, but it
    // also trips a §16 exclusion (money movement). Unsafe must win — never laundered to
    // already_solved by the new reach.
    const v = classifyBuildRequest("build a receipt agent that can also transfer money to vendors", {
      contracts: resolveKnownAgents([CREATED_RECEIPT]),
    });
    assert.equal(v.label, "unsafe");
    assert.equal(v.unsafeExclusion, "money movement");
    assert.equal(v.matchedAgent, undefined);
  });

  it("REGRESSION: a genuinely novel request with NO matching created contract stays buildable", () => {
    // The Receipt Vault contract is present, but the request is about something else
    // entirely — no identity token overlaps, so the reach correctly finds nothing.
    const v = classifyBuildRequest("build a tax specialist agent", {
      contracts: resolveKnownAgents([CREATED_RECEIPT]),
    });
    assert.equal(v.label, "buildable");
    assert.equal(v.matchedAgent, undefined);
  });

  it("is deterministic — same request ⇒ deep-equal verdict", () => {
    assert.deepEqual(
      classifyBuildRequest("build a tax specialist agent"),
      classifyBuildRequest("build a tax specialist agent"),
    );
    assert.deepEqual(
      classifyBuildRequest("build an agent that moves money"),
      classifyBuildRequest("build an agent that moves money"),
    );
  });
});
