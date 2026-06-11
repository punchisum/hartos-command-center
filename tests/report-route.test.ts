/**
 * tests/report-route.test.ts — "run a report" routes to a gated, runner-executed report job.
 * A research report must NOT hijack this (it belongs to the Research agent).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeCockpitCommand } from "../src/cockpit/command-router.js";
import { jobSpecFromRoute, isAgentJobKind } from "../src/jobs/agent-job.js";

describe("report routing + job spec", () => {
  it("'report' is a recognized agent-job kind", () => {
    assert.equal(isAgentJobKind("report"), true);
  });

  for (const req of ["run a report", "give me a state report", "generate a status report", "weekly review"]) {
    it(`"${req}" → a gated report job needing the local runner`, () => {
      const route = routeCockpitCommand(req);
      assert.equal(route.selectedMode, "report", `${req} should route to report`);
      assert.equal(route.needsProposal, true);
      assert.equal(route.requiresLocalRunner, true);
      const spec = jobSpecFromRoute(route);
      assert.ok(spec, "a report route must yield a job spec");
      assert.equal(spec?.kind, "report");
      assert.match(spec?.localCommand ?? "", /report:run/);
    });
  }

  it("a RESEARCH report routes to the Research agent, NOT the state-report job", () => {
    const route = routeCockpitCommand("show me the research report on agentic AI");
    assert.notEqual(route.selectedMode, "report");
  });

  it("'run a research dossier' does not hijack the report path", () => {
    const route = routeCockpitCommand("run a research dossier on vector databases");
    assert.notEqual(route.selectedMode, "report");
  });
});
