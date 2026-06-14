/**
 * tests/agent-registry-view.test.ts
 *
 * Proves the PURE, Worker-safe `agentRegistryView` builder honours the constitutional truth-layer
 * contract (docs/superpowers/specs/2026-06-14-dynamic-agent-registration-cockpit.md):
 *   (a) approved manifest + liveness "up"          => derivedStatus "live"
 *   (b) approved manifest + NO liveness (unknown)  => "watch", NOT "live" (health-confirmation)
 *   (c) draft manifest                             => "draft"
 *   (d) killSwitch on + execute permission         => "disarmed"
 *   (e) NEVER throws on [] / undefined / malformed input
 * plus the projection details (health, lastHeartbeat, arming, latestActivity, knownRisks).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agentRegistryView } from "../src/runtime/views/agent-registry-view.js";
import type { AgentManifest } from "../src/agents/agent-manifest.js";

/** A complete, approved manifest with execute hands and an arming flag. */
function approvedManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    agentId: "fitness-agent",
    displayName: "Fitness Agent",
    capabilitySummary: "Tracks and mutates fitness state.",
    parentId: "orchestrator",
    tier: "T2",
    lifecycle: "approved",
    permissions: { propose: true, execute: true },
    armingFlag: "HARTOS_ALLOW_FITNESS",
    sourceProposalId: "prop-1",
    knownRisks: ["may over-write streaks"],
    createdAt: "2026-06-01T00:00:00.000Z",
    approvedAt: "2026-06-02T00:00:00.000Z",
    retiredAt: null,
    ...overrides,
  };
}

describe("agentRegistryView", () => {
  it("(a) approved manifest + liveness up => derivedStatus 'live'", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest()],
      liveness: { verdicts: [{ agentId: "fitness-agent", state: "up", lastEvidenceAt: "2026-06-13T12:00:00.000Z", ageHours: 1 }] },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.derivedStatus, "live");
    assert.equal(rows[0]!.health, "up");
    assert.equal(rows[0]!.lastHeartbeat, "2026-06-13T12:00:00.000Z");
  });

  it("(b) approved manifest with NO liveness => 'watch', NOT 'live' (health-confirmation invariant)", () => {
    const rows = agentRegistryView({ manifests: [approvedManifest()] });
    assert.equal(rows[0]!.derivedStatus, "watch");
    assert.notEqual(rows[0]!.derivedStatus, "live");
    // No verdict for this agent => health falls back to "unknown" and heartbeat is null.
    assert.equal(rows[0]!.health, "unknown");
    assert.equal(rows[0]!.lastHeartbeat, null);
  });

  it("(b') approved manifest whose ONLY verdict is for another agent stays 'watch'", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest()],
      liveness: { verdicts: [{ agentId: "some-other-agent", state: "up" }] },
    });
    assert.equal(rows[0]!.derivedStatus, "watch");
    assert.equal(rows[0]!.health, "unknown");
  });

  it("(c) draft manifest => 'draft'", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest({ lifecycle: "draft" })],
      // even with an "up" verdict, a draft never reads as live
      liveness: { verdicts: [{ agentId: "fitness-agent", state: "up" }] },
    });
    assert.equal(rows[0]!.derivedStatus, "draft");
  });

  it("(d) killSwitch on + execute permission => 'disarmed' and arming.armed=false", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest()],
      liveness: { verdicts: [{ agentId: "fitness-agent", state: "up" }] },
      killSwitchOn: true,
    });
    assert.equal(rows[0]!.derivedStatus, "disarmed");
    assert.equal(rows[0]!.arming.armed, false);
    assert.equal(rows[0]!.arming.flag, "HARTOS_ALLOW_FITNESS");
  });

  it("(d') killSwitch on but NO execute permission stays health-derived (not disarmed)", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest({ permissions: { propose: true, execute: false } })],
      liveness: { verdicts: [{ agentId: "fitness-agent", state: "up" }] },
      killSwitchOn: true,
    });
    // No execute hands => kill-switch does not disarm it; "up" liveness => live.
    assert.equal(rows[0]!.derivedStatus, "live");
    assert.equal(rows[0]!.arming.armed, true);
  });

  it("(e) NEVER throws on undefined / null / [] / malformed input", () => {
    assert.doesNotThrow(() => assert.deepEqual(agentRegistryView(undefined), []));
    assert.doesNotThrow(() => assert.deepEqual(agentRegistryView(null), []));
    assert.doesNotThrow(() => assert.deepEqual(agentRegistryView({ manifests: [] }), []));
    // garbage shapes for every field
    assert.doesNotThrow(() => agentRegistryView({ manifests: 42 as unknown as AgentManifest[] }));
    assert.doesNotThrow(() =>
      agentRegistryView({
        manifests: [null as unknown as AgentManifest, undefined as unknown as AgentManifest, 7 as unknown as AgentManifest],
      }),
    );
    assert.doesNotThrow(() =>
      agentRegistryView({
        manifests: [{ agentId: "x" } as unknown as AgentManifest],
        liveness: { verdicts: "nope" as unknown as [] },
        proposals: "nope" as unknown as [],
        killSwitchOn: "yes" as unknown as boolean,
      }),
    );
  });

  it("(e') a malformed manifest degrades safely with health 'unknown' and is NEVER 'live', never throwing", () => {
    const rows = agentRegistryView({ manifests: [{ agentId: "broken" } as unknown as AgentManifest] });
    assert.equal(rows.length, 1);
    // Health-confirmation invariant: a malformed (unconfirmed) manifest is never "live" — with no
    // health read-model it is approved-but-unconfirmed-shaped => "watch". The authored `lifecycle`
    // field defaults to "draft", and every projected field degrades safely.
    assert.notEqual(rows[0]!.derivedStatus, "live");
    assert.equal(rows[0]!.derivedStatus, "watch");
    assert.equal(rows[0]!.lifecycle, "draft");
    assert.equal(rows[0]!.health, "unknown");
    assert.equal(rows[0]!.lastHeartbeat, null);
    assert.deepEqual(rows[0]!.knownRisks, []);
    assert.equal(rows[0]!.latestActivity, null);
  });

  it("projects the most-recent proposal targeting the agent as latestActivity", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest()],
      proposals: [
        { targetId: "fitness-agent", title: "older", status: "approved", updatedAt: "2026-06-10T00:00:00.000Z" },
        { targetId: "fitness-agent", title: "newest", status: "pending", updatedAt: "2026-06-12T00:00:00.000Z" },
        { targetId: "other-agent", title: "not mine", status: "pending", updatedAt: "2026-06-13T00:00:00.000Z" },
      ],
    });
    assert.deepEqual(rows[0]!.latestActivity, {
      title: "newest",
      status: "pending",
      updatedAt: "2026-06-12T00:00:00.000Z",
    });
  });

  it("falls back to an undated proposal when no dated one exists, and null when none target the agent", () => {
    const withUndated = agentRegistryView({
      manifests: [approvedManifest()],
      proposals: [{ targetId: "fitness-agent", title: "no date", status: "draft" }],
    });
    assert.equal(withUndated[0]!.latestActivity?.title, "no date");
    assert.equal(withUndated[0]!.latestActivity?.updatedAt, null);

    const none = agentRegistryView({
      manifests: [approvedManifest()],
      proposals: [{ targetId: "someone-else", title: "x", status: "draft", updatedAt: "2026-06-13T00:00:00.000Z" }],
    });
    assert.equal(none[0]!.latestActivity, null);
  });

  it("normalises an unknown liveness state to 'unknown' health and yields 'watch'", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest()],
      liveness: { verdicts: [{ agentId: "fitness-agent", state: "bogus" as unknown as "unknown" }] },
    });
    assert.equal(rows[0]!.health, "unknown");
    assert.equal(rows[0]!.derivedStatus, "watch");
  });

  it("a null arming flag yields armed=true (nothing to arm), even with execute perm", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest({ armingFlag: null })],
      liveness: { verdicts: [{ agentId: "fitness-agent", state: "up" }] },
    });
    assert.equal(rows[0]!.arming.flag, null);
    assert.equal(rows[0]!.arming.armed, true);
  });

  it("retired manifest is never live — even with a stray 'up' verdict (resurrection path closed)", () => {
    const rows = agentRegistryView({
      manifests: [approvedManifest({ lifecycle: "retired", retiredAt: "2026-06-13T00:00:00.000Z" })],
      // A just-retired agent may still have a fresh "up" heartbeat; the deriver short-circuits
      // retired -> offline BEFORE the liveness check, so it can never be resurrected to "live".
      liveness: { verdicts: [{ agentId: "fitness-agent", state: "up" }] },
    });
    assert.equal(rows[0]!.derivedStatus, "offline");
    assert.notEqual(rows[0]!.derivedStatus, "live");
  });

  it("preserves permissions and copies knownRisks (no aliasing of the source array)", () => {
    const m = approvedManifest({ knownRisks: ["r1", "r2"] });
    const rows = agentRegistryView({ manifests: [m] });
    assert.deepEqual(rows[0]!.permissions, { propose: true, execute: true });
    assert.deepEqual(rows[0]!.knownRisks, ["r1", "r2"]);
    assert.notEqual(rows[0]!.knownRisks, m.knownRisks, "knownRisks must be a copy, not the source array");
  });
});
