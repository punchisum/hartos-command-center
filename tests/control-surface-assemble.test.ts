/**
 * tests/control-surface-assemble.test.ts
 *
 * Phase 18E — the assembler + end-to-end snapshot. Hermetic: inputs are injected
 * (no disk, no network, no LLM). Proves the assembler computes verdict/severity
 * from facts, that `unknown` renders an honest unavailable card, that the rendered
 * card shows the COMPUTED verdict (not a model's), and that no execute path exists
 * anywhere in the rendered HTML.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleAgentBundles,
  buildControlSurfaceState,
  buildControlSurfaceSnapshot,
  buildAttentionStrip,
  ALLOWED_FIX_ACTION_KINDS,
  type ControlSurfaceInputs,
  type FactSummarizer,
} from "../src/cockpit/control-surface/index.js";

const NOW = "2026-06-05T12:00:00.000Z";
const FRESH = "2026-06-05T09:00:00.000Z"; // 3h before NOW
const STALE = "2026-06-04T00:00:00.000Z"; // > 24h before NOW

function inputs(overrides: Partial<ControlSurfaceInputs> = {}): ControlSurfaceInputs {
  return {
    now: NOW,
    tax: {
      proposalStatus: "runtime_provisioned",
      specId: "spec-tax",
      updatedAt: FRESH,
      workerName: "hartos-tax-agent-smoke",
      targetEnv: "staging",
      workerHealthOk: true,
      workerHealthAt: FRESH,
      webhookSet: true,
      triggerConfigured: false,
      secretNames: ["SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY"],
      smokeOk: true,
      smokeAt: FRESH,
      auditEvents: [{ event: "runtime_provisioned", at: FRESH, detail: "worker=hartos-tax-agent-smoke" }],
    },
    fitness: { live: false, metrics: {}, dataFreshness: null },
    ops: { live: true, metrics: { activeCards: 3, blockedCards: 1 }, dataFreshness: STALE },
    factory: { queueDepth: 0, lastScaffoldName: "tax-agent", lastScaffoldAt: FRESH, buildState: "green", buildAt: FRESH, testCount: 1445 },
    systemHealth: [{ name: "Cloudflare", state: "g", detail: "live" }],
    proposalQueue: { needsApproval: 2, readyLocal: 1, blocked: 0, completed: 4 },
    recentActivity: [{ text: "Tax runtime provisioned", at: FRESH, level: "g" }],
    ...overrides,
  };
}

describe("18E — assembler computes verdict from facts", () => {
  it("Tax (fresh smoke, healthy) → GREEN with a security fix (service-role key)", () => {
    const bundles = assembleAgentBundles(inputs());
    const tax = bundles.find((b) => b.agentId === "tax")!;
    assert.equal(tax.verdict, "GREEN");
    assert.ok(tax.fixes.some((f) => f.severity === "security"), "smoke worker + service-role key → a security fix");
    // The security fix is a copy-CLI, never an execute.
    const sec = tax.fixes.find((f) => f.severity === "security")!;
    assert.equal(sec.action.kind, "copy_cli");
    assert.match(sec.action.payload, /wrangler delete/);
  });

  it("Ops (stale + blocked) → AMBER with stale-revenue ranked above blocked", () => {
    const bundles = assembleAgentBundles(inputs());
    const ops = bundles.find((b) => b.agentId === "ops")!;
    assert.equal(ops.verdict, "AMBER");
    const sevs = ops.fixes.map((f) => f.severity);
    assert.deepEqual(sevs, ["stale-revenue", "blocked"]);
  });

  it("Fitness (read-model not live) → UNKNOWN, unavailable", () => {
    const bundles = assembleAgentBundles(inputs());
    const fit = bundles.find((b) => b.agentId === "fitness")!;
    assert.equal(fit.verdict, "UNKNOWN");
    assert.equal(fit.unavailable, true);
  });
});

describe("18E — attention strip is severity-ranked across agents", () => {
  it("security (Tax) sorts above stale-revenue (Ops) above blocked (Ops)", () => {
    const bundles = assembleAgentBundles(inputs());
    // summary not needed for the strip; fixes are already computed by the assembler
    const strip = buildAttentionStrip(bundles);
    assert.equal(strip[0]!.severity, "security");
    assert.equal(strip[0]!.agentId, "tax");
    assert.deepEqual(strip.map((s) => s.severity), ["security", "stale-revenue", "blocked", "next", "note"]);
  });
});

describe("18E — end-to-end snapshot + render", () => {
  it("rendered card uses the COMPUTED verdict, not the model's", async () => {
    const liar = (() => ({
      verdict: "RED",
      confidence: "LOW",
      selectedFactKeys: [],
      summaryText: "all good",
      citedFactKeys: [],
      whyVerdict: "explained",
      fixProse: [],
    })) as unknown as FactSummarizer;
    const { state, html } = await buildControlSurfaceSnapshot({ inputs: inputs(), now: NOW, summarizer: liar });
    const tax = state.bundles.find((b) => b.agentId === "tax")!;
    assert.equal(tax.verdict, "GREEN", "model said RED; computed GREEN must win");
    // The Tax card pill renders the computed verdict.
    assert.match(html, /<span class="vpill g">GREEN<\/span>/);
    assert.doesNotMatch(html, /vpill r">RED/);
  });

  it("system verdict is the worst agent verdict (AMBER here: Ops stale)", async () => {
    const state = await buildControlSurfaceState({ inputs: inputs(), now: NOW });
    assert.equal(state.systemVerdict, "AMBER");
  });

  it("an unknown bundle renders an honest unavailable card (no fabricated facts)", async () => {
    const { html } = await buildControlSurfaceSnapshot({ inputs: inputs(), now: NOW });
    assert.match(html, /unknown · data unavailable/);
    assert.match(html, /class="card unavailable"/);
    assert.match(html, /can't assess Fitness/i);
  });

  it("the rendered HTML contains NO execute action of any kind", async () => {
    const { html } = await buildControlSurfaceSnapshot({ inputs: inputs(), now: NOW });
    // Scan the static markup (strip <script> blocks, which hold JS template literals).
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
    const actionKinds = [...markup.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]!);
    assert.ok(actionKinds.length > 0, "there should be at least one action button to check");
    for (const k of actionKinds) {
      assert.ok((ALLOWED_FIX_ACTION_KINDS as readonly string[]).includes(k), `unexpected action kind: ${k}`);
    }
    assert.doesNotMatch(html, /data-action="execute"/);
    assert.doesNotMatch(html, /data-action="deploy"/);
    // The client JS must not contain a fetch/XHR mutation path.
    assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|\.post\(/);
  });

  it("builder view is proposal-driven (runtime_provisioned → 6/7 done)", async () => {
    const state = await buildControlSurfaceState({ inputs: inputs(), now: NOW });
    assert.ok(state.builder, "builder view present when a tax proposal exists");
    assert.equal(state.builder!.steps.filter((s) => s.state === "done").length, 6);
    assert.equal(state.builder!.missingCredentials.length > 0, true, "missing creds surfaced (names only)");
  });
});
