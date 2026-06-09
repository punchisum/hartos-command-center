/**
 * tests/memory-capture.test.ts
 *
 * Executive Memory persister — proves the pure capture policy (dedupe-by-day, window prune,
 * cap) and the flag-gated, honesty-respecting capture step. Closes the loop: a brief becomes a
 * snapshot becomes memory. Hermetic + deterministic: in-memory store, literal `now`, no I/O.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordSnapshot, InMemoryMemoryStore } from "../src/awareness/memory-store.js";
import { captureSnapshot, MEMORY_CAPTURE_FLAG } from "../src/awareness/memory-capture.js";
import type { MemorySnapshot } from "../src/awareness/executive-memory.js";
import type { StrategicBrief } from "../src/awareness/strategic-awareness.js";

const NOW = "2026-06-09T12:00:00.000Z";
function at(daysAgo: number, hour = 12): string {
  return new Date(Date.parse(NOW) - daysAgo * 86400000 + (hour - 12) * 3600000).toISOString();
}
function snap(atIso: string, risk = "ops stale"): MemorySnapshot {
  return { at: atIso, riskSubjects: [risk], driftSubjects: [], opportunitySubjects: [], blindSpotSubjects: [], metrics: [{ key: "risk_count", value: 1 }] };
}
function brief(over: Partial<StrategicBrief> = {}): StrategicBrief {
  return {
    status: "ok",
    risks: [{ risk: "ops stale", why: "w", evidence: "e", confidence: "high", suggestedAction: "a" }],
    opportunities: [], drift: [], blindSpots: [], recommendedFocus: "triage", note: "n",
    ...over,
  };
}

describe("recordSnapshot — compactness policy (pure)", () => {
  it("dedupes by UTC day — newest snapshot of the day wins", () => {
    const morning = snap(at(0, 8), "old read");
    const evening = snap(at(0, 20), "fresh read");
    const out = recordSnapshot([morning], evening);
    assert.equal(out.length, 1, "one snapshot per day");
    assert.deepEqual(out[0]!.riskSubjects, ["fresh read"], "newest kept");
  });

  it("prunes snapshots outside the window", () => {
    const existing = [snap(at(90)), snap(at(40)), snap(at(10))];
    const out = recordSnapshot(existing, snap(at(0)), { windowDays: 60 });
    // 90d drops; 40d + 10d + today remain.
    assert.equal(out.length, 3);
    assert.ok(!out.some((s) => s.at === at(90)));
  });

  it("caps total to most-recent N", () => {
    const existing = Array.from({ length: 10 }, (_, i) => snap(at(10 - i)));
    const out = recordSnapshot(existing, snap(at(0)), { maxSnapshots: 5, windowDays: 365 });
    assert.equal(out.length, 5, "capped");
    // sorted oldest→newest; last is today
    assert.equal(out[out.length - 1]!.at, at(0));
  });

  it("sorts oldest→newest and drops unparseable timestamps", () => {
    const out = recordSnapshot([snap("not-a-date"), snap(at(5))], snap(at(2)));
    assert.equal(out.length, 2, "garbage dropped");
    assert.ok(Date.parse(out[0]!.at) < Date.parse(out[1]!.at));
  });
});

describe("captureSnapshot — flag-gated + honest", () => {
  it("does NOTHING when the flag is off (default)", async () => {
    const store = new InMemoryMemoryStore();
    const r = await captureSnapshot({ store, brief: brief(), now: NOW, env: {} });
    assert.equal(r.captured, false);
    assert.match(r.reason, new RegExp(MEMORY_CAPTURE_FLAG));
    assert.equal((await store.read()).length, 0);
  });

  it("captures when the flag is on and the brief is ok", async () => {
    const store = new InMemoryMemoryStore();
    const env = { [MEMORY_CAPTURE_FLAG]: "true" };
    const r = await captureSnapshot({ store, brief: brief(), now: NOW, env });
    assert.equal(r.captured, true);
    assert.equal(r.total, 1);
    const stored = await store.read();
    assert.deepEqual(stored[0]!.riskSubjects, ["ops stale"], "subject projected, not prose");
  });

  it("skips an insufficient_evidence brief even with the flag on (never remembers nothing)", async () => {
    const store = new InMemoryMemoryStore();
    const env = { [MEMORY_CAPTURE_FLAG]: "true" };
    const empty = brief({ status: "insufficient_evidence", risks: [], recommendedFocus: null });
    const r = await captureSnapshot({ store, brief: empty, now: NOW, env });
    assert.equal(r.captured, false);
    assert.match(r.reason, /insufficient_evidence/);
    assert.equal((await store.read()).length, 0);
  });

  it("daily heartbeat: two captures same day → one stored snapshot", async () => {
    const store = new InMemoryMemoryStore();
    const env = { [MEMORY_CAPTURE_FLAG]: "true" };
    await captureSnapshot({ store, brief: brief(), now: at(0, 9), env });
    const r2 = await captureSnapshot({ store, brief: brief(), now: at(0, 18), env });
    assert.equal(r2.total, 1, "deduped to one per day");
  });

  it("over time the captured history feeds executive memory (loop closes)", async () => {
    // Capture the same recurring risk across three distinct days → a recurring pattern emerges.
    const store = new InMemoryMemoryStore();
    const env = { [MEMORY_CAPTURE_FLAG]: "true" };
    await captureSnapshot({ store, brief: brief(), now: at(30), env });
    await captureSnapshot({ store, brief: brief(), now: at(15), env });
    await captureSnapshot({ store, brief: brief(), now: at(2), env });
    const history = await store.read();
    assert.equal(history.length, 3);
    // The executive-memory engine should now see "ops stale" as recurring.
    const { executiveMemory } = await import("../src/awareness/executive-memory.js");
    const mem = executiveMemory(history, { now: NOW });
    assert.equal(mem.status, "ok");
    assert.ok(mem.recurringPatterns.some((p) => p.subject.includes("ops stale")), "recurring pattern detected from captured history");
  });
});
