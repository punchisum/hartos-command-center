/**
 * tests/execution-adapter.test.ts — Phase 3.5 (adversarial).
 * The first execution path is fail-closed: it refuses unless EVERY condition holds, the
 * per-action flag is OFF by default, a global kill-switch overrides it, every attempt
 * (incl. refusals) is audited, and the one action is reversible + idempotent.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runExecutionAdapter,
  isActionAllowlisted,
  KILL_SWITCH_ENV,
  type ExecutionContext,
} from "../src/execution/execution-adapter.js";
import {
  refreshSyncAdapter,
  REFRESH_SYNC_FLAG,
  type RefreshSyncStore,
} from "../src/execution/adapters/refresh-sync.js";

const now = "2026-06-08T12:00:00Z";
const future = "2026-06-09T12:00:00Z";
const past = "2026-06-07T12:00:00Z";

interface StubStore extends RefreshSyncStore { expired: number; stamped: number; }
function makeStore(stale = 3): StubStore {
  let staleCount = stale;
  const s: StubStore = {
    expired: 0,
    stamped: 0,
    async countStaleProposals() { return staleCount; },
    async expireStaleProposals() { const n = staleCount; staleCount = 0; s.expired += n; return n; },
    async stampSync() { s.stamped += 1; },
  };
  return s;
}
function makeAudit() {
  const events: { event: string; detail: string }[] = [];
  return { events, writeAudit: async (event: string, detail: string) => { events.push({ event, detail }); } };
}
function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    proposalId: "p1", status: "approved_for_execution", expiresAt: future, now,
    hasCapabilityToken: true, env: { [REFRESH_SYNC_FLAG]: "true" }, ...over,
  };
}

describe("execution adapter — fail-closed gate (3.3/3.4/3.5)", () => {
  it("flag OFF (default) → refused, NOT executed, attempt + refusal audited", async () => {
    const store = makeStore(); const audit = makeAudit();
    const r = await runExecutionAdapter(refreshSyncAdapter, ctx({ env: {} }), { adapterDeps: { store, now, proposalId: "p1" }, writeAudit: audit.writeAudit });
    assert.equal(r.executed, false);
    assert.equal(store.expired, 0, "must not touch data when refused");
    assert.ok(audit.events.some((e) => e.event === "execution_attempt"));
    assert.ok(audit.events.some((e) => e.event === "execution_refused"));
  });

  it("global kill-switch overrides the per-action flag → refused", async () => {
    const store = makeStore(); const audit = makeAudit();
    const r = await runExecutionAdapter(refreshSyncAdapter, ctx({ env: { [REFRESH_SYNC_FLAG]: "true", [KILL_SWITCH_ENV]: "on" } }), { adapterDeps: { store, now, proposalId: "p1" }, writeAudit: audit.writeAudit });
    assert.equal(r.executed, false);
    assert.equal(store.expired, 0);
  });

  it("blocks a non-approved status, an expired proposal, and a missing token", async () => {
    const mk = () => ({ adapterDeps: { store: makeStore(), now, proposalId: "p1" }, writeAudit: makeAudit().writeAudit });
    assert.equal((await runExecutionAdapter(refreshSyncAdapter, ctx({ status: "pending_approval" }), mk())).executed, false);
    assert.equal((await runExecutionAdapter(refreshSyncAdapter, ctx({ expiresAt: past }), mk())).executed, false);
    assert.equal((await runExecutionAdapter(refreshSyncAdapter, ctx({ hasCapabilityToken: false }), mk())).executed, false);
  });

  it("happy path: all conditions + flag ON → executes once, reports before/after, audited", async () => {
    const store = makeStore(3); const audit = makeAudit();
    const r = await runExecutionAdapter(refreshSyncAdapter, ctx(), { adapterDeps: { store, now, proposalId: "p1" }, writeAudit: audit.writeAudit });
    assert.equal(r.executed, true);
    assert.equal(r.outcome?.reversible, true);
    assert.deepEqual(r.outcome?.before, { staleProposals: 3 });
    assert.deepEqual(r.outcome?.after, { staleProposals: 0 });
    assert.equal(store.expired, 3);
    assert.equal(store.stamped, 1);
    assert.ok(audit.events.some((e) => e.event === "executed"));
  });

  it("idempotent: a re-run on a clean queue expires 0 (no-op, still reversible)", async () => {
    const store = makeStore(0); const audit = makeAudit();
    const r = await runExecutionAdapter(refreshSyncAdapter, ctx(), { adapterDeps: { store, now, proposalId: "p1" }, writeAudit: audit.writeAudit });
    assert.equal(r.executed, true);
    assert.deepEqual(r.outcome?.after, { staleProposals: 0 });
    assert.equal(store.expired, 0);
  });

  it("dryRun never writes", async () => {
    const store = makeStore(2);
    const out = await refreshSyncAdapter.dryRun({ store, now, proposalId: "p1" });
    assert.equal(out.ran, false);
    assert.equal(store.expired, 0);
    assert.equal(store.stamped, 0);
  });

  it("isActionAllowlisted: OFF by default, ON only on exact 'true', killed by the switch", () => {
    assert.equal(isActionAllowlisted(refreshSyncAdapter, {}), false);
    assert.equal(isActionAllowlisted(refreshSyncAdapter, { [REFRESH_SYNC_FLAG]: "1" }), false);
    assert.equal(isActionAllowlisted(refreshSyncAdapter, { [REFRESH_SYNC_FLAG]: "true" }), true);
    assert.equal(isActionAllowlisted(refreshSyncAdapter, { [REFRESH_SYNC_FLAG]: "true", [KILL_SWITCH_ENV]: "on" }), false);
  });
});
