/**
 * tests/agent-job.test.ts — the autonomy spine's gated agent-job contract.
 *
 * The cockpit creates a PENDING job proposal (never executes); the runner executes only
 * Hart-approved jobs under each action's own gates. These tests prove the contract.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jobSpecFromRoute, buildAgentJobProposal } from "../src/jobs/agent-job.js";
import { routeCockpitCommand } from "../src/cockpit/command-router.js";

const NOW = "2026-06-10T12:00:00.000Z";

describe("jobSpecFromRoute", () => {
  it("maps a Beezulbub hunt to a runnable job with the honest local command + gates", () => {
    const spec = jobSpecFromRoute(routeCockpitCommand("Beezulbub hunt markdown editors"))!;
    assert.equal(spec.kind, "beezulbub.hunt");
    assert.equal(spec.arg, "markdown_editors");
    assert.match(spec.localCommand, /beezulbub:hunt/);
    assert.ok(spec.gates.some((g) => /BEEZULBUB_ALLOW_NETWORK/.test(g)));
  });

  it("maps a research action to research.brief carrying the question", () => {
    const spec = jobSpecFromRoute(routeCockpitCommand("research the drone defense market"))!;
    assert.equal(spec.kind, "research.brief");
    assert.match(spec.localCommand, /research:run/);
  });

  it("returns null for read-only routes (no job needed)", () => {
    assert.equal(jobSpecFromRoute(routeCockpitCommand("what is Wolverine seeing?")), null);
    assert.equal(jobSpecFromRoute(routeCockpitCommand("show capability dossiers")), null);
  });
});

describe("buildAgentJobProposal — the approval floor", () => {
  const route = routeCockpitCommand("Beezulbub hunt markdown editors");
  const spec = jobSpecFromRoute(route)!;
  const p = buildAgentJobProposal(spec, route, NOW);

  it("is pending_approval + non-executable + Hart-gated (the cockpit never executes)", () => {
    assert.equal(p.status, "pending_approval");
    assert.equal(p.executable, false);
    assert.equal(p.requiredApproval, "Hart");
    assert.equal(String(p.actionType), "agent_job");
    assert.ok(p.blockedReason.length > 0);
  });

  it("carries the job payload the runner needs + honest safety notes", () => {
    assert.equal(p.proposedPayload["jobKind"], "beezulbub.hunt");
    assert.equal(p.proposedPayload["jobArg"], "markdown_editors");
    assert.ok(String(p.proposedPayload["localCommand"]).includes("beezulbub:hunt"));
    assert.ok(p.safetyNotes.some((n) => /never executes/i.test(n)));
    assert.ok(p.safetyNotes.some((n) => /approves/.test(n)));
  });

  it("is deterministic for a given now (no ambient clock)", () => {
    assert.deepEqual(buildAgentJobProposal(spec, route, NOW), buildAgentJobProposal(spec, route, NOW));
  });
});

describe("/api/ask creates a gated job proposal for runner-required actions (worker-level)", () => {
  it("persists an agent_job via the proposal writer and reports jobCreated; read-only asks create none", async () => {
    const { handleCockpitRequest } = await import("../src/runtime/cloudflare-cockpit-worker.js");
    const persisted: unknown[] = [];
    const ctx = {
      proposalWriteProvider: async (proposals: unknown[]) => {
        persisted.push(...proposals);
        return { attempted: true, persisted: proposals.length, failed: 0, reason: "ok" };
      },
    } as Parameters<typeof handleCockpitRequest>[2];

    const post = (request: string) =>
      new Request("https://cockpit.local/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request }),
      });

    const res = await handleCockpitRequest(post("Beezulbub hunt markdown editors"), {}, ctx);
    const data = (await res.json()) as { jobCreated: { persisted: boolean; title: string } | null; routing: { selectedAgent: string } };
    assert.equal(data.routing.selectedAgent, "beezulbub");
    assert.ok(data.jobCreated, "a gated job must be created");
    assert.equal(data.jobCreated!.persisted, true);
    const job = persisted[0] as { actionType: string; status: string; executable: boolean };
    assert.equal(job.actionType, "agent_job");
    assert.equal(job.status, "pending_approval");
    assert.equal(job.executable, false);

    // A read-only question must NOT create a job.
    const res2 = await handleCockpitRequest(post("what is Wolverine seeing?"), {}, ctx);
    const data2 = (await res2.json()) as { jobCreated: unknown };
    assert.equal(data2.jobCreated, null);
    assert.equal(persisted.length, 1);
  });
});
