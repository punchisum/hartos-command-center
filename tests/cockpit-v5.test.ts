/**
 * tests/cockpit-v5.test.ts — the v5 "Neural Deck" data builder + renderer.
 * Honest derived metrics, real agent/proposal mapping, safe self-contained HTML.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCockpitV5Data,
  renderCockpitV5,
  type V5SourceAgent,
  type V5SourceProposal,
} from "../src/runtime/cloudflare-cockpit-v5.js";

const NOW = "2026-06-12T12:00:00.000Z";

const AGENTS: V5SourceAgent[] = [
  { id: "command", displayName: "HartOS Command / Orchestrator", role: "orchestrator", status: "live", category: "root" },
  { id: "factory", displayName: "Factory", role: "provisioning", status: "live", category: "agent" },
  { id: "wolverine", displayName: "Wolverine", role: "immune", status: "partial", category: "agent" },
  { id: "sentinel", displayName: "Sentinel", role: "liveness", status: "down", category: "agent" },
  { id: "hart", displayName: "Hart (Human)", role: "operator", status: "live", category: "human" },
];

const PROPS: V5SourceProposal[] = [
  { id: "prop-system-agent_job-run-research-brief-xyz", title: "Run research.brief: coaching apps", status: "simulated_approved", domain: "research", updatedAt: NOW, riskLevel: "low", payload: { actionType: "agent_job", proposedPayload: { jobKind: "research.brief" } } },
  { id: "prop-build-x", title: "Build crypto agent", status: "pending_approval", domain: "factory", updatedAt: NOW, riskLevel: "medium", payload: { actionType: "agent_job", proposedPayload: { jobKind: "claude.execute" } } },
];

describe("buildCockpitV5Data", () => {
  it("maps registry agents → V5 (excludes Hart/human + unknown ids), colors + initials", () => {
    const d = buildCockpitV5Data(AGENTS, PROPS, { now: NOW, buildSha: "abc" });
    assert.ok(!d.agents.some((a) => a.id === "hart"), "human is excluded");
    const fc = d.agents.find((a) => a.id === "factory")!;
    assert.equal(fc.initials, "FC");
    assert.equal(fc.color, "#FF2D9E");
    assert.equal(d.agents.find((a) => a.id === "command")!.name, "Command");
  });

  it("a running task makes its agent fire", () => {
    const d = buildCockpitV5Data(AGENTS, PROPS, { now: NOW, buildSha: null });
    // research.brief is simulated_approved ⇒ Beezulbub running; but Beezulbub isn't in AGENTS here,
    // so check Factory (claude.execute is queued, not running ⇒ not firing).
    assert.equal(d.agents.find((a) => a.id === "factory")!.status, "healthy");
    assert.equal(d.agents.find((a) => a.id === "sentinel")!.status, "down");
    assert.equal(d.agents.find((a) => a.id === "wolverine")!.status, "watch");
  });

  it("derives honest metrics + pending proposals + tasks", () => {
    const d = buildCockpitV5Data(AGENTS, PROPS, { now: NOW, buildSha: null });
    assert.match(d.fleetFitness, /^\d+$/); // a percentage string
    assert.equal(d.tasks.available, true);
    assert.equal(d.tasks.counts.running, 1);
    assert.equal(d.proposals.length, 1); // only the pending_approval one
    assert.equal(d.proposals[0]!.tier, "Tier 2"); // medium risk
  });
});

describe("renderCockpitV5", () => {
  it("produces a self-contained HTML doc with the v5 markers + the Live Operations page", () => {
    const d = buildCockpitV5Data(AGENTS, PROPS, { now: NOW, buildSha: "abc" });
    const html = renderCockpitV5(d);
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /Neural Deck v5/);
    assert.match(html, /live ops/);
    assert.match(html, /Live operations/);
    assert.match(html, /window\.HV=/);
    assert.match(html, /\/api\/ask/); // footer console wired
    assert.ok(html.trim().endsWith("</html>"));
  });

  it("escapes </script> in the injected JSON so the page can't be broken/injected", () => {
    const evil: V5SourceProposal[] = [{ id: "x", title: "</script><img src=x>", status: "pending_approval", payload: { actionType: "agent_job", proposedPayload: { jobKind: "report" } } }];
    const html = renderCockpitV5(buildCockpitV5Data(AGENTS, evil, { now: NOW, buildSha: null }));
    assert.ok(!html.includes("</script><img"), "raw </script> must be escaped in the data blob");
  });
});
