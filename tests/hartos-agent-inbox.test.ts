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
