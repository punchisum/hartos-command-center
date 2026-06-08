/**
 * tests/agent-detail-registry.test.ts — Phase C / Gap C.
 *
 * Proves the literal Phase C DoD: a NEW agent can register a detail read-model and
 * get a full /agent/<domain>/ui dashboard with NO bespoke UI or route code — just a
 * declarative spec. fitness/ops stay bespoke; everything here is the generic seam.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGenericAgentDetail, type AgentDetailSpec } from "../src/read-models/agent-detail-registry.js";
import { SupabaseReadClient, type FetchLike } from "../src/read-models/supabase-read-client.js";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";

const NOW = "2026-06-08T10:00:00Z";

// A new agent, declared purely as DATA — no builder/renderer/route code anywhere.
const DEMO_SPEC: AgentDetailSpec = {
  domain: "research",
  label: "Research",
  urlEnv: "DEMO_URL",
  keyEnv: "DEMO_KEY",
  rpcs: [
    { rpc: "get_research_overview", section: "Overview", render: "kv", columns: [{ header: "Open threads", field: "open" }, { header: "Sources", field: "sources" }] },
    { rpc: "get_research_findings", section: "Findings", render: "table", columns: [{ header: "Title", field: "title" }, { header: "Confidence", field: "confidence" }] },
  ],
};

const BODIES: Record<string, unknown> = {
  get_research_overview: [{ open: 3, sources: 12 }],
  get_research_findings: [
    { title: "Market sizing", confidence: "high" },
    { title: "Competitor scan", confidence: "medium" },
  ],
};

function clientFor(fetch: FetchLike): SupabaseReadClient {
  return new SupabaseReadClient({ url: "https://stub", key: "anon", allowedTables: [], allowedRpcs: DEMO_SPEC.rpcs.map((r) => r.rpc) }, fetch);
}
function okFetch(): FetchLike {
  return async (url) => {
    const name = DEMO_SPEC.rpcs.map((r) => r.rpc).find((n) => url.includes(`/rpc/${n}`)) ?? "";
    return { ok: true, status: 200, json: async () => BODIES[name] ?? [] };
  };
}

describe("generic agent detail registry (Phase C / Gap C)", () => {
  it("builds render-ready sections from a declarative spec (no bespoke builder)", async () => {
    const detail = await buildGenericAgentDetail(clientFor(okFetch()), DEMO_SPEC, {}, { now: NOW });
    assert.equal(detail.kind, "generic");
    assert.equal(detail.type, "research");
    assert.equal(detail.status, "ok");
    assert.equal(detail.sections.length, 2);
    const overview = detail.sections.find((s) => s.title === "Overview")!;
    assert.equal(overview.kind, "kv");
    assert.deepEqual(overview.rows, [["Open threads", "3"], ["Sources", "12"]]);
    const findings = detail.sections.find((s) => s.title === "Findings")!;
    assert.equal(findings.kind, "table");
    assert.equal(findings.rows.length, 2);
    assert.deepEqual(findings.rows[0], ["Market sizing", "high"]);
  });

  it("degrades a failed RPC to an empty section + a note (nothing fabricated)", async () => {
    const fetch: FetchLike = async (url) =>
      url.includes("get_research_findings")
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => BODIES.get_research_overview };
    const detail = await buildGenericAgentDetail(clientFor(fetch), DEMO_SPEC, {}, { now: NOW });
    assert.equal(detail.status, "degraded");
    assert.ok(detail.notes.some((n) => /Findings unavailable/.test(n)));
    assert.equal(detail.sections.find((s) => s.title === "Findings")!.rows.length, 0);
  });

  it("the /agent/<domain>/ui route renders a NEW agent with no bespoke route/UI code", async () => {
    const detail = await buildGenericAgentDetail(clientFor(okFetch()), DEMO_SPEC, {}, { now: NOW });
    const res = await handleCockpitRequest(new Request("https://c/agent/research/ui"), {}, {
      runtimeMode: "hosted",
      agentDetailProvider: async (d) => (d === "research" ? detail : null),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const html = await res.text();
    assert.match(html, /Research dashboard/);
    assert.match(html, /Overview/);
    assert.match(html, /Findings/);
    assert.match(html, /Market sizing/);
  });

  it("the /agent/<domain> JSON route returns the generic detail for a registered agent", async () => {
    const detail = await buildGenericAgentDetail(clientFor(okFetch()), DEMO_SPEC, {}, { now: NOW });
    const res = await handleCockpitRequest(new Request("https://c/agent/research"), {}, {
      runtimeMode: "hosted",
      agentDetailProvider: async (d) => (d === "research" ? detail : null),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { kind: string; type: string; sections: unknown[] };
    assert.equal(body.kind, "generic");
    assert.equal(body.type, "research");
    assert.equal(body.sections.length, 2);
  });

  it("an unknown agent domain serves an honest 'unavailable' page (no fabrication)", async () => {
    const res = await handleCockpitRequest(new Request("https://c/agent/unknown/ui"), {}, {
      runtimeMode: "hosted",
      agentDetailProvider: async () => null,
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /unavailable/i);
    assert.match(html, /Nothing is fabricated/i);
  });
});
