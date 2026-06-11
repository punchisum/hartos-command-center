/**
 * tests/data-source-generator.test.ts — T6 generates a FUNCTIONAL data source (not a disabled stub),
 * and the output composes with the T5 typecheck verifier.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateDataSource, validateDataSourceSpec, type DataSourceSpec } from "../src/factory/data-source-generator.js";
import { makeTypecheckVerifier, type TypecheckRunner } from "../src/builder/verify-typecheck.js";

const spec: DataSourceSpec = {
  agentName: "Invoice Monitor",
  metrics: [
    { key: "open", label: "Open invoices", column: "open_count" },
    { key: "overdue", label: "Overdue", column: "overdue_count" },
  ],
};

describe("data-source generator (T6)", () => {
  it("rejects an empty/invalid spec", () => {
    assert.ok(validateDataSourceSpec({ agentName: "", metrics: [] }).length >= 2);
    assert.ok(validateDataSourceSpec({ agentName: "X", metrics: [{ key: "a", label: "A", column: "" }] }).length >= 1);
    assert.throws(() => generateDataSource({ agentName: "", metrics: [] }), /Invalid data-source spec/);
  });

  it("generates a FUNCTIONAL, ENABLED source (not the disabled placeholder)", () => {
    const g = generateDataSource(spec);
    assert.equal(g.slug, "invoice-monitor");
    assert.equal(g.rpc, "get_invoice_monitor_overview");
    assert.equal(g.readModel.enabled, true, "the read-model is ENABLED, unlike the disabled archetype");
    assert.deepEqual(g.readModel.allowedRpcs, ["get_invoice_monitor_overview"]);
    // The resolver references the RPC, the function, and every declared metric column.
    assert.match(g.module, /resolveInvoiceMonitorOverview/);
    assert.match(g.module, /get_invoice_monitor_overview/);
    assert.match(g.module, /open_count/);
    assert.match(g.module, /overdue_count/);
    assert.match(g.module, /empty: latest === null/);
  });

  it("honours a custom rpc + freshness column", () => {
    const g = generateDataSource({ ...spec, rpc: "get_ar_summary", freshnessColumn: "as_of" });
    assert.equal(g.rpc, "get_ar_summary");
    assert.match(g.module, /latest\[\"as_of\"\]/);
  });

  it("composes with the T5 verifier — the generated module is handed to typecheck as a .ts file", async () => {
    const g = generateDataSource(spec);
    let sawTsFile = false;
    const runner: TypecheckRunner = async (_dir, files) => {
      sawTsFile = files.some((f) => f.endsWith(".ts"));
      return { ok: true, output: "" };
    };
    const verify = makeTypecheckVerifier({ runner });
    const r = await verify([{ path: `${g.slug}-overview.ts`, content: g.module }]);
    assert.equal(r.ok, true);
    assert.equal(sawTsFile, true, "T6 output flows into the T5 verifier as code to typecheck");
  });
});
