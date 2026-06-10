/**
 * tests/wolverine-capability-risk.test.ts — Wolverine audits Beezulbub capability scouts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectCapabilityRisk } from "../src/wolverine/detectors/capability-risk.js";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import type { CapabilityScoutSummary } from "../src/beezulbub/scout-summary.js";

const NOW = "2026-06-10T12:00:00Z";

function scout(over: Partial<CapabilityScoutSummary>): CapabilityScoutSummary {
  return {
    target: "markdown_editor",
    mode: "live",
    candidateCount: 5,
    topCandidate: "vditor",
    topLicense: "MIT",
    topStaleRisk: "low",
    riskyTopLicense: false,
    staleTop: false,
    ...over,
  };
}

describe("detectCapabilityRisk", () => {
  it("flags a copyleft/unknown-license top pick (medium, doctrine_drift)", () => {
    const f = detectCapabilityRisk({ now: NOW, capabilityScouts: [scout({ topLicense: "AGPL-3.0", riskyTopLicense: true })] });
    const lic = f.find((x) => x.id === "capability-risk:license")!;
    assert.equal(lic.severity, "medium");
    assert.equal(lic.category, "doctrine_drift");
    assert.match(lic.evidence, /AGPL-3\.0/);
    assert.equal(lic.approvalRequired, false); // advisory — never absorbs
  });

  it("flags a stale top pick (low, improvement)", () => {
    const f = detectCapabilityRisk({ now: NOW, capabilityScouts: [scout({ staleTop: true, topStaleRisk: "high" })] });
    assert.ok(f.some((x) => x.id === "capability-risk:stale-top" && x.severity === "low"));
  });

  it("clean scouts produce no findings", () => {
    assert.deepEqual(detectCapabilityRisk({ now: NOW, capabilityScouts: [scout({})] }), []);
  });

  it("no scouts ⇒ not assessed", () => {
    assert.deepEqual(detectCapabilityRisk({ now: NOW }), []);
  });

  it("is wired into the default audit", () => {
    const report = wolverineAudit({ now: NOW, capabilityScouts: [scout({ topLicense: "GPL-3.0", riskyTopLicense: true })] });
    assert.ok(report.repairQueue.some((x) => x.source === "capability-risk"));
  });
});
