import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { officiateFromManifest, type OfficiationOutcome } from "../src/hartos/factory-officiator.js";
import { compileSpecToManifest } from "../src/hartos/manifest-compiler.js";
import type { AgentSpec, AgentManifest } from "../src/hartos/manifest-types.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-09T12:00:00.000Z";
const FRESH = "2026-06-09T10:00:00.000Z";

const SPEC: AgentSpec = {
  specId: "spec-invoices-001",
  agentName: "invoices-agent",
  domain: "finance",
  targetReadModelType: "other",
  purpose: "Surface outstanding invoices and propose follow-ups.",
  dataSources: ["invoice_overview"],
  capabilities: ["summarize outstanding"],
  label: "Invoices",
  icon: "🧾",
  proposalTypes: ["invoice_followup_plan"],
  outputs: [
    { id: "summary", kind: "cockpit exec summary", targetFolder: "reports/invoices", description: "summary" },
  ],
  jobType: "monitoring",
  boundary: {
    maxFilesWritten: 2,
    targetFolder: "reports/invoices",
    stopConditions: ["stop when done"],
  },
  acceptanceCriteria: ["lists every invoice honestly"],
  riskLevel: "high",
  prereqs: ["Supabase project exists"],
  cockpitDone: true,
  approvalRequired: false,
  failureMode: "boundary_exceeded",
};

const HEALTHY: ReadModelSummary = {
  id: "other",
  type: "other",
  status: "ok",
  confidence: "high",
  lines: ["Invoices resolved."],
  metrics: { outstanding: 3 },
  recommendation: "Read-only; review in the cockpit.",
  dataFreshness: FRESH,
  degradedSources: [],
};

const MANIFEST: AgentManifest = compileSpecToManifest(SPEC);

describe("factory-officiator — officiateFromManifest", () => {
  it("valid manifest → officiated:true + expandedRegistry includes the new contract", () => {
    const outcome: OfficiationOutcome = officiateFromManifest(MANIFEST, HEALTHY, { now: NOW });
    assert.equal(outcome.officiated, true);
    const found = outcome.expandedRegistry.find((c) => c.type === MANIFEST.contract.type);
    assert.ok(found, "expandedRegistry must include the born contract's type");
  });

  it("manifest without contract → officiated:false + violations non-empty", () => {
    const noContract = { ...MANIFEST, contract: undefined } as unknown as AgentManifest;
    const outcome = officiateFromManifest(noContract, HEALTHY, { now: NOW });
    assert.equal(outcome.officiated, false);
    assert.ok(outcome.violations.length > 0, "violations must be non-empty when contract is absent");
  });

  it("persistProposal.dryRun === true always (carried in proposedPayload)", () => {
    const outcome = officiateFromManifest(MANIFEST, HEALTHY, { now: NOW });
    assert.equal(outcome.persistProposal.proposedPayload["dryRun"], true);
  });

  it("persistProposal.executable === false always", () => {
    const outcome = officiateFromManifest(MANIFEST, HEALTHY, { now: NOW });
    assert.equal(outcome.persistProposal.executable, false);
  });

  it("expandedRegistry deduplication — same type twice yields only one entry", () => {
    // compileSpecToManifest always produces type "other" for targetReadModelType "other".
    // Passing the same contract again via a second manifest must not duplicate the entry.
    const outcome = officiateFromManifest(MANIFEST, HEALTHY, { now: NOW });
    const type = MANIFEST.contract.type;
    const entries = outcome.expandedRegistry.filter((c) => c.type === type);
    assert.equal(entries.length, 1, `type "${type}" must appear exactly once in expandedRegistry`);
  });
});
