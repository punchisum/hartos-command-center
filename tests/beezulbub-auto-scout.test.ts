/**
 * tests/beezulbub-auto-scout.test.ts
 *
 * Tests for the Beezulbub spec-lock → auto-scout orchestration (plan §5).
 *
 * Hermetic: no env, no network, no fs, no clock reads (timestamps injected).
 * Proves the network gate stays closed by default — a mock fetch is asserted
 * NOT invoked when BEEZULBUB_ALLOW_NETWORK is unset and no allowNetwork option
 * is passed. (These tests assume BEEZULBUB_ALLOW_NETWORK is unset, like the
 * existing beezulbub-live-scout tests.)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  specLockToScoutRequest,
  assembleReportFromScout,
  autoScoutForSpec,
  type LockedAgentSpec,
} from "../src/beezulbub/auto-scout.js";
import { serializeCapabilityReport } from "../src/beezulbub/capability-report.js";
import type { BeezulbubScoutResult } from "../src/beezulbub/types.js";

const FIXED_TS = "2026-06-09T00:00:00.000Z";

// A spec whose target has built-in fixture candidates in the registry.
const dashboardSpec: LockedAgentSpec = {
  agentSpecId: "spec-dash-001",
  targetCapability: "dashboard_layout",
  searchNotes: "Read-only metric dashboard for the cockpit.",
};

/** A fetch spy that records whether it was ever called (and never networks). */
function makeSpyFetch(): { fetchImpl: typeof fetch; wasCalled: () => boolean } {
  let called = false;
  const fetchImpl: typeof fetch = async (): Promise<Response> => {
    called = true;
    // Should never run in these tests; return a benign empty result.
    return new Response(JSON.stringify({ total_count: 0, items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, wasCalled: () => called };
}

// ─── specLockToScoutRequest ───────────────────────────────────────────────────

describe("specLockToScoutRequest", () => {
  test("maps the spec target and does NOT set live by default (fixture path)", () => {
    const request = specLockToScoutRequest(dashboardSpec);
    assert.equal(request.target, "dashboard_layout");
    // No allowNetwork option ⇒ never opts into the live code path.
    assert.equal(request.live, undefined);
  });

  test("opts into the live code path only when allowNetwork is requested", () => {
    const request = specLockToScoutRequest(dashboardSpec, { allowNetwork: true });
    assert.equal(request.live, true);
  });

  test("forwards limit and fetchImpl without touching process.env", () => {
    const { fetchImpl } = makeSpyFetch();
    const before = process.env["BEEZULBUB_ALLOW_NETWORK"];
    const request = specLockToScoutRequest(dashboardSpec, { limit: 3, fetchImpl });
    assert.equal(request.limit, 3);
    assert.equal(request.fetchImpl, fetchImpl);
    // The orchestration must never mutate the env gate.
    assert.equal(process.env["BEEZULBUB_ALLOW_NETWORK"], before);
  });
});

// ─── assembleReportFromScout ──────────────────────────────────────────────────

describe("assembleReportFromScout", () => {
  const scoutResult: BeezulbubScoutResult = {
    target: "dashboard_layout",
    candidates: [
      {
        name: "tremor-dashboard",
        sourceUrl: "https://github.com/tremorlabs/tremor",
        targetCapability: "dashboard_layout",
        reason: "Dashboard component library.",
        estimatedValue: 8,
        licenseGuess: "MIT",
        staleRisk: "low",
        notes: "Tailwind-based.",
      },
    ],
    timestamp: FIXED_TS,
    mode: "fixture",
    recommendation: "Found 1 candidate.",
  };

  test("composes candidates as candidateSources (never redefined)", () => {
    const report = assembleReportFromScout(dashboardSpec, scoutResult, {
      generatedAt: FIXED_TS,
    });
    assert.equal(report.agentSpecId, "spec-dash-001");
    assert.equal(report.candidateSources.length, 1);
    assert.equal(report.candidateSources[0]!.name, "tremor-dashboard");
  });

  test("searchScope carries target, scout mode, and spec notes", () => {
    const report = assembleReportFromScout(dashboardSpec, scoutResult, {
      generatedAt: FIXED_TS,
    });
    assert.equal(report.searchScope.target, "dashboard_layout");
    assert.equal(report.searchScope.mode, "fixture");
    assert.equal(report.searchScope.notes, dashboardSpec.searchNotes);
  });

  test("proposedBuildPlanChanges stays empty (advisory, build-plan is later)", () => {
    const report = assembleReportFromScout(dashboardSpec, scoutResult, {
      generatedAt: FIXED_TS,
    });
    assert.deepEqual(report.proposedBuildPlanChanges, []);
  });

  test("records a scout audit step before the builder's recommend step", () => {
    const report = assembleReportFromScout(dashboardSpec, scoutResult, {
      generatedAt: FIXED_TS,
    });
    assert.equal(report.auditTrail[0]!.stage, "scout");
    assert.equal(report.auditTrail.at(-1)!.stage, "recommend");
  });

  test("honors the §19 confidence bound through to the report", () => {
    const report = assembleReportFromScout(dashboardSpec, scoutResult, {
      generatedAt: FIXED_TS,
      baseConfidence: 0.9,
      inputConfidences: [0.4, 0.7],
    });
    assert.equal(report.confidence, 0.4);
  });
});

// ─── autoScoutForSpec — offline default (gate closed) ─────────────────────────

describe("autoScoutForSpec — offline default", () => {
  test("with the flag unset and no allowNetwork option ⇒ fixture mode", async () => {
    const report = await autoScoutForSpec(dashboardSpec, { generatedAt: FIXED_TS });
    assert.equal(report.searchScope.mode, "fixture");
  });

  test("candidates come from the registry fixtures offline", async () => {
    const report = await autoScoutForSpec(dashboardSpec, { generatedAt: FIXED_TS });
    // The registry ships built-in dashboard_layout candidates.
    assert.ok(report.candidateSources.length > 0);
    const names = report.candidateSources.map((c) => c.name);
    assert.ok(names.includes("tremor-dashboard") || names.includes("shadcn-dashboard"));
  });

  test("a mock fetch is NEVER invoked when the flag is unset (no network)", async () => {
    const { fetchImpl, wasCalled } = makeSpyFetch();
    // allowNetwork is omitted ⇒ fixture code path ⇒ fetch must not run.
    const report = await autoScoutForSpec(dashboardSpec, {
      fetchImpl,
      generatedAt: FIXED_TS,
    });
    assert.equal(wasCalled(), false, "fetch must not be called without the network flag");
    assert.equal(report.searchScope.mode, "fixture");
  });

  test("even with allowNetwork:true, the env gate stays closed ⇒ fixture, no fetch", async () => {
    // The option opts into the live code path, but BEEZULBUB_ALLOW_NETWORK is
    // unset, so live-scout falls back to fixtures and never calls fetch.
    const { fetchImpl, wasCalled } = makeSpyFetch();
    const report = await autoScoutForSpec(dashboardSpec, {
      allowNetwork: true,
      fetchImpl,
      generatedAt: FIXED_TS,
    });
    assert.equal(wasCalled(), false, "env gate, not the option, authorizes network");
    assert.equal(report.searchScope.mode, "fixture");
  });

  test("never throws for an unknown target ⇒ empty fixtures, fixture mode", async () => {
    const oddSpec: LockedAgentSpec = {
      agentSpecId: "spec-odd-001",
      targetCapability: "no_such_capability_target",
    };
    const report = await autoScoutForSpec(oddSpec, { generatedAt: FIXED_TS });
    assert.equal(report.searchScope.mode, "fixture");
    assert.deepEqual(report.candidateSources, []);
  });
});

// ─── serializer secret-scan integration ───────────────────────────────────────

describe("autoScoutForSpec — serialization is secret-scan clean", () => {
  test("a clean auto-scouted report serializes without throwing", async () => {
    const report = await autoScoutForSpec(dashboardSpec, { generatedAt: FIXED_TS });
    assert.doesNotThrow(() => serializeCapabilityReport(report));
  });

  test("serializer rejects a planted secret in the assembled report", () => {
    // Build the secret at runtime to avoid static secret scanners.
    const prefix = "sk";
    const secret = `${prefix}-${"a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"}`;
    const scoutResult: BeezulbubScoutResult = {
      target: "dashboard_layout",
      candidates: [
        {
          name: "leaky",
          targetCapability: "dashboard_layout",
          reason: `embedded credential: ${secret}`,
          estimatedValue: 1,
          staleRisk: "high",
          notes: "planted",
        },
      ],
      timestamp: FIXED_TS,
      mode: "fixture",
      recommendation: "planted",
    };
    const report = assembleReportFromScout(dashboardSpec, scoutResult, {
      generatedAt: FIXED_TS,
    });
    assert.throws(
      () => serializeCapabilityReport(report),
      /Secret-looking value/,
      "Serializer must secret-scan and reject a planted secret"
    );
  });
});
