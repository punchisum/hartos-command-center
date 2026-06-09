/**
 * tests/spine-e2e.test.ts — TRACK C: the mutation-spine LOOP, proven end-to-end.
 *
 * The pieces are each unit-tested in isolation (execution-dispatch.test.ts, state-delta.test.ts,
 * fleet-brain.test.ts, fleet-delta-consumer.test.ts). This test proves they INTEROPERATE as one
 * chain — command → mutate → audit → delta → refresh → learn — with the doctrine floor held
 * across the whole chain, not just inside each unit:
 *
 *   (1) dispatchMutation runs a REAL gated adapter (clickup-comment) with an injected fake store,
 *       its ALLOW_EXEC_* flag ARMED, hasCapabilityToken:true, and an injected `now`. A write
 *       actually executes ⇒ result.executed === true AND a non-null §13 StateDeltaSignal (the
 *       audit-after projection) rides on the DispatchResult.
 *   (2) assembleBriefing synthesizes a prior Fleet Brain briefing over fixture signals that
 *       INCLUDES the delta's domain ("ops") plus an unrelated domain ("fitness").
 *   (3) applyDispatchDeltas folds the real DispatchResult into the briefing: the matching item is
 *       updated incrementally while every non-matching item is byte-identical (SAME reference).
 *   (4) §19 holds THROUGH the chain: a freshness-only delta (the live audit-after projection)
 *       never launders the matched item's confidence band upward — and an older/stale delta only
 *       ever degrades it.
 *   (5) the floor holds end-to-end: a refused dispatch (flag OFF) AND a dry-run both yield a null
 *       delta and leave the briefing UNCHANGED (same reference) — nothing executed ⇒ nothing learnt.
 *   (6) determinism: identical inputs through the whole chain → deep-equal output.
 *
 * Fully hermetic: fake stores, armed flag passed as a plain env map, injected Date — NO real
 * network / DB / fs / ambient clock. Doctrine: nothing here executes against a live system or
 * approves anything; the human-approval floor is unmoved (the gate is the only path to a write).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dispatchMutation, type DispatchResult } from "../src/execution/execution-dispatch.js";
import { makeClickUpCommentStore, type ClickUpRestClient } from "../src/execution/clickup-client.js";
import { CLICKUP_COMMENT_FLAG } from "../src/execution/adapters/clickup-comment.js";
import { applyDispatchDeltas } from "../src/fleet/delta-consumer.js";
import { assembleBriefing, type FleetBriefing } from "../src/fleet/fleet-brain.js";
import type { FleetSignal, AgentSignal } from "../src/read-models/agent-signal.js";
import type { StateDeltaSignal } from "../src/execution/state-delta.js";
import type { AdapterRunResult, ExecutionOutcome } from "../src/execution/execution-adapter.js";

// ─── Injected clock (never the ambient one) ──────────────────────────────────────
const NOW = new Date("2026-06-09T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const LATER = new Date("2026-06-09T13:00:00.000Z");

const CARD = { id: "card-virtual-card-api", name: "Virtual Card API Clarification" };
// The authorizing proposal — already approved_for_execution + non-expired; the gate still demands
// the capability token + the armed flag below. The human-approval floor is upstream of all this.
const PROPOSAL = { id: "p-ops-followup", status: "approved_for_execution" as const, expiresAt: null };

// ─── A fake ClickUp client (no network): open card, no prior comments ─────────────
function fakeClient(status: string, comments: Array<{ id: string; text: string }> = []): ClickUpRestClient {
  let st = status;
  const list = [...comments];
  let n = list.length;
  return {
    async getTask() { return { id: CARD.id, name: CARD.name, status: st }; },
    async listComments() { return [...list]; },
    async createComment(_t, text) { const id = `c-${++n}`; list.push({ id, text }); return { id }; },
    async setStatus(_t, s) { st = s; },
  };
}

/** Silence the framework-level [exec-audit] trace the runner logs, without losing it elsewhere. */
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = () => {};
  return fn().finally(() => { console.log = orig; });
}

// ─── Fleet Brain signal fixtures (explicit — no hidden clock-reading defaults) ────
function signal(over: Partial<AgentSignal> = {}): AgentSignal {
  return {
    verdict: "clear",
    confidence: "high",
    facts: [],
    freshness: "live",
    reason: "all clear",
    nextAction: null,
    approvalNeeded: false,
    ...over,
  };
}

function fleetSignal(id: string, type: FleetSignal["type"], over: Partial<AgentSignal> = {}): FleetSignal {
  return { id, type, signal: signal(over) };
}

/**
 * The prior briefing the loop refreshes: an ops item (the delta's domain, confidence "medium" so
 * §19 has a band to NOT launder upward) and an unrelated fitness item (must stay byte-identical).
 */
function priorBriefing(): FleetBriefing {
  return assembleBriefing({
    signals: [
      fleetSignal("ops", "ops", { verdict: "urgent", confidence: "medium", freshness: "live" }),
      fleetSignal("fitness", "fitness", { verdict: "green", confidence: "high", freshness: "live" }),
    ],
    now: NOW,
  });
}

// ─── A real executed dispatch, hermetic + deterministic ───────────────────────────
async function runRealDispatch(env: Record<string, string | undefined>, opts: { dryRun?: boolean; hasCapabilityToken?: boolean } = {}): Promise<DispatchResult> {
  const store = makeClickUpCommentStore(fakeClient("open", []));
  return quiet(() => dispatchMutation(
    {
      adapterId: "clickup-comment",
      proposal: PROPOSAL,
      target: { cardId: CARD.id, cardName: CARD.name, commentText: "Resurfacing — needs a decision." },
      store,
    },
    env,
    { now: NOW, hasCapabilityToken: opts.hasCapabilityToken ?? true, dryRun: opts.dryRun },
  ));
}

const ARMED = { [CLICKUP_COMMENT_FLAG]: "true" };

// ─── (1)+(2)+(3) the happy loop: command → mutate → delta → incremental refresh ───
describe("spine-e2e — the mutation loop interoperates command→mutate→delta→refresh", () => {
  it("a real gated mutation projects a delta that incrementally refreshes ONLY the matching item", async () => {
    // (1) dispatch a REAL gated mutation with the flag armed + token + injected now.
    const dispatch = await runRealDispatch(ARMED);
    assert.equal(dispatch.result.executed, true, "the gated write actually executed");
    assert.ok(dispatch.delta, "an executed write projects a non-null §13 delta (audit-after projection)");
    assert.equal(dispatch.delta!.domain, "ops", "the delta carries the adapter's default ops domain");
    assert.equal(dispatch.delta!.auditId, PROPOSAL.id, "the delta's auditId is the authorizing proposal id");
    // The delta is the audit-after projection: comment count went 0 → 1.
    assert.equal((dispatch.delta!.after as Record<string, unknown>).comments, 1);
    assert.equal(dispatch.delta!.freshness, "live", "a just-emitted delta (now == asOf) is live");

    // (2) a prior briefing that INCLUDES the delta's domain.
    const prior = priorBriefing();
    const opsBefore = prior.items.find((i) => i.domain === "ops")!;
    const fitnessBefore = prior.items.find((i) => i.domain === "fitness")!;
    assert.ok(opsBefore, "the prior briefing includes the delta's ops domain");

    // (3) refresh: fold the REAL DispatchResult through the consumer into the Brain.
    const next = applyDispatchDeltas(prior, [dispatch], LATER);
    const opsAfter = next.items.find((i) => i.domain === "ops")!;
    const fitnessAfter = next.items.find((i) => i.domain === "fitness")!;

    // The matched ops item is a NEW object that recorded the touching auditId.
    assert.notEqual(opsAfter, opsBefore, "the matched item is re-synthesized into a new object");
    assert.ok(opsAfter.auditIds.includes(PROPOSAL.id), "the matched item records the delta's auditId");
    // The unrelated fitness item is byte-identical — the Brain did NOT re-digest the world.
    assert.equal(fitnessAfter, fitnessBefore, "an untouched item is returned by the SAME reference");
    // Deltas were applied, so the honest generatedAt is the injected refresh time.
    assert.equal(next.generatedAt, LATER.toISOString());
  });

  // ─── (4) §19 holds THROUGH the chain — never laundered upward by a delta ─────────
  it("§19: the live audit-after delta NEVER launders the matched item's confidence upward", async () => {
    const dispatch = await runRealDispatch(ARMED);
    assert.equal(dispatch.delta!.freshness, "live");

    const prior = priorBriefing();
    const opsBefore = prior.items.find((i) => i.domain === "ops")!;
    assert.equal(opsBefore.confidence, "medium", "the ops item starts at medium");

    const next = applyDispatchDeltas(prior, [dispatch], LATER);
    const opsAfter = next.items.find((i) => i.domain === "ops")!;
    // A delta carries NO confidence band of its own — even a fresh/live delta can only HOLD or
    // degrade, never raise. The merged item keeps the WEAKEST band (here: still medium, not high).
    assert.equal(opsAfter.confidence, "medium", "a freshness-only (live) delta cannot upgrade the band (§19)");
    assert.notEqual(opsAfter.confidence, "high");
  });

  it("§19: an older/stale delta through the chain only DEGRADES — it never raises the band", () => {
    // A stale executed dispatch (constructed in the consumer-test shape) flowing through the SAME
    // collectDeltas → applyDeltas chain must degrade a medium item, never raise it.
    const prior = priorBriefing();
    const opsBefore = prior.items.find((i) => i.domain === "ops")!;
    assert.equal(opsBefore.confidence, "medium");

    const staleDispatch = executedDispatch(staleOpsDelta());
    const next = applyDispatchDeltas(prior, [staleDispatch], LATER);
    const opsAfter = next.items.find((i) => i.domain === "ops")!;

    assert.equal(opsAfter.freshness, "stale", "freshness takes the worst contributing band");
    assert.equal(opsAfter.confidence, "low", "stale evidence degrades medium → low (never upward) (§19)");
    assert.ok(opsAfter.auditIds.includes("audit-ops-stale"));
  });
});

// ─── (5) the floor holds end-to-end: refused + dry-run dispatch ⇒ no delta, no learn ─
describe("spine-e2e — the human-approval floor holds across the whole chain", () => {
  it("a REFUSED dispatch (flag OFF) yields a null delta and leaves the briefing UNCHANGED", async () => {
    // Flag OFF (default) ⇒ the gate refuses BEFORE any write. The loop must learn nothing.
    const refused = await runRealDispatch({});
    assert.equal(refused.result.executed, false, "the gate refused — nothing executed");
    assert.equal(refused.delta, null, "a refusal emits NO delta");

    const prior = priorBriefing();
    const next = applyDispatchDeltas(prior, [refused], LATER);
    assert.equal(next, prior, "no executed delta ⇒ the SAME briefing reference, unchanged");
    assert.equal(next.generatedAt, NOW_ISO, "generatedAt is NOT bumped for a no-op refresh");
  });

  it("a DRY-RUN dispatch (preview only) yields a null delta and leaves the briefing UNCHANGED", async () => {
    // Even with the flag armed + token, a dry-run writes nothing ⇒ no delta ⇒ nothing to learn.
    const preview = await runRealDispatch(ARMED, { dryRun: true });
    assert.equal(preview.result.executed, false, "a dry-run writes nothing");
    assert.equal(preview.delta, null, "a dry-run emits NO delta");

    const prior = priorBriefing();
    const next = applyDispatchDeltas(prior, [preview], LATER);
    assert.equal(next, prior, "a preview-only batch ⇒ same briefing reference, unchanged");
    assert.equal(next.generatedAt, NOW_ISO);
  });

  it("a MIXED batch (refused + dry-run + one real write) applies ONLY the real write", async () => {
    const refused = await runRealDispatch({});
    const preview = await runRealDispatch(ARMED, { dryRun: true });
    const real = await runRealDispatch(ARMED);
    assert.equal(real.result.executed, true);

    const prior = priorBriefing();
    const opsBefore = prior.items.find((i) => i.domain === "ops")!;
    const fitnessBefore = prior.items.find((i) => i.domain === "fitness")!;

    const next = applyDispatchDeltas(prior, [refused, preview, real], LATER);
    const opsAfter = next.items.find((i) => i.domain === "ops")!;
    const fitnessAfter = next.items.find((i) => i.domain === "fitness")!;

    // ONLY the one real write's delta touched the ops item; the floor dropped the other two.
    assert.notEqual(opsAfter, opsBefore, "the real write's delta touched the ops item");
    assert.ok(opsAfter.auditIds.includes(PROPOSAL.id));
    assert.equal(opsAfter.auditIds.length, 1, "exactly one delta (the real write) was applied");
    assert.equal(fitnessAfter, fitnessBefore, "the unrelated item is still byte-identical");
  });
});

// ─── (6) determinism: identical inputs through the WHOLE chain → deep-equal ───────
describe("spine-e2e — determinism across the whole chain", () => {
  it("same inputs → deep-equal briefing (the loop is pure + clock-injected)", async () => {
    const build = async (): Promise<FleetBriefing> => {
      const dispatch = await runRealDispatch(ARMED);
      return applyDispatchDeltas(priorBriefing(), [dispatch], LATER);
    };
    assert.deepEqual(await build(), await build());
  });
});

// ─── Helpers for the stale-delta §19 leg (the consumer-test DispatchResult shape) ─

function staleOpsDelta(): StateDeltaSignal {
  return {
    source: "clickup-comment",
    domain: "ops",
    changedEntity: CARD.name,
    before: { comments: 0 },
    after: { comments: 1 },
    actionType: "ops_followup_plan",
    auditId: "audit-ops-stale",
    affectedAgents: ["Ops Agent", "Fleet Brain"],
    freshness: "stale",
  };
}

function staleOutcome(): ExecutionOutcome {
  return {
    ran: true,
    reversible: true,
    before: { comments: 0 },
    after: { comments: 1 },
    summary: "added comment",
  };
}

/** A real-shaped executed DispatchResult carrying `d` — flows through collectDeltas like any other. */
function executedDispatch(d: StateDeltaSignal): DispatchResult {
  const result: AdapterRunResult = {
    adapterId: "clickup-comment",
    precondition: { allowed: true, denials: [] },
    executed: true,
    outcome: staleOutcome(),
  };
  return { adapterId: "clickup-comment", result, delta: d };
}
