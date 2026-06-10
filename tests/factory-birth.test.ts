/**
 * tests/factory-birth.test.ts
 *
 * The one-command agent birth: the pure runway builder + the render. Proves it produces an ordered,
 * gated runway grounded in the dry-run plan, asks for missing inputs, and never claims to mutate.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planAgentCreation } from "../src/cockpit/agent-planner/agent-planner.js";
import { birthRunway } from "../src/cockpit/agent-planner/birth-runway.js";
import { renderBirth } from "../scripts/factory-birth.js";

describe("birthRunway — ordered, gated runway from a dry-run plan", () => {
  const plan = planAgentCreation("build a travel planning agent", { answers: { dataSources: ["booking emails"], commands: ["track trips"], interfaces: ["web cockpit"] } });
  const runway = birthRunway(plan);

  it("starts with the local scaffold (no push) and is sequentially ordered", () => {
    assert.equal(runway[0]!.order, 1);
    assert.match(runway[0]!.command, /agent:scaffold-build/);
    assert.equal(runway[0]!.mutation, false, "local scaffold does not mutate a provider");
    for (let i = 0; i < runway.length; i += 1) assert.equal(runway[i]!.order, i + 1);
  });

  it("marks push/provision/deploy steps as mutations carrying their real gate", () => {
    const push = runway.find((s) => /scaffold-pr/.test(s.command));
    const deploy = runway.find((s) => /runtime-provision/.test(s.command));
    assert.ok(push && push.mutation, "the PR push is a mutation");
    assert.ok(deploy && deploy.mutation, "the deploy is a mutation");
    assert.match(deploy!.gate, /CLOUDFLARE/);
  });

  it("ends with the honest hand-built adapter step (the real per-domain work)", () => {
    const last = runway[runway.length - 1]!;
    assert.match(last.title, /adapter|data source/i);
    assert.equal(last.mutation, false);
  });
});

describe("renderBirth — honest, asks for what's missing, never claims to build", () => {
  it("surfaces clarifying questions when inputs are missing", () => {
    const lines = renderBirth("build a travel planning agent").join("\n");
    assert.match(lines, /Needs from you/);
    assert.match(lines, /DRY-RUN; nothing created/);
    assert.match(lines, /PLANNED only/);
  });

  it("names the derived agent + the gated runway", () => {
    const lines = renderBirth("build a travel planning agent", { dataSources: ["x"], commands: ["y"], interfaces: ["z"] }).join("\n");
    assert.match(lines, /Agent: travel-planning-agent/);
    assert.match(lines, /Gated runway to a LIVE agent/);
    assert.match(lines, /scaffold-build/);
  });
});
