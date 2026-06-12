/**
 * tests/telegram-alert-passes.test.ts — the failed-job + liveness alert passes (injected fakes).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TelegramSender } from "../src/shared/types.js";
import { EMPTY_ALERT_STATE } from "../src/telegram/alert-bus.js";
import { failureRowToAlert, runFailedJobAlertPass } from "../src/telegram/run-failed-job-alert.js";
import { livenessTransitionAlerts, runLivenessAlertPass } from "../src/telegram/run-liveness-alert.js";
import type { FleetLiveness, LivenessState, LivenessVerdict } from "../src/sentinel/sentinel-liveness.js";

const ARMED = { ALLOW_TELEGRAM_NOTIFY: "true", TELEGRAM_BOT_TOKEN: "123:abc", HARTOS_TELEGRAM_NOTIFY_CHAT_ID: "555" };
const NOW = "2026-06-12T11:30:00.000Z";

class FakeSender implements TelegramSender {
  public sent: Array<{ chatId: string; text: string }> = [];
  async sendMessage(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
}

const fakeDb = (rows: unknown[]) => ({ async query() { return { rows }; }, async close() {} });

// ── failed-job alert pass ───────────────────────────────────────────────────────────────────────

describe("failureRowToAlert (severity mapping)", () => {
  it("execution_failed → high; high-risk → critical; autoheal_reverted → medium", () => {
    assert.equal(failureRowToAlert({ proposal_id: "p1", event: "execution_failed", at: NOW, title: "x", risk_level: "medium" }).severity, "high");
    assert.equal(failureRowToAlert({ proposal_id: "p2", event: "execution_failed", at: NOW, risk_level: "high" }).severity, "critical");
    assert.equal(failureRowToAlert({ proposal_id: "p3", event: "autoheal_reverted", at: NOW }).severity, "medium");
    assert.equal(failureRowToAlert({ proposal_id: "p4", event: "failed", at: NOW }).severity, "high");
  });
  it("keys each occurrence by proposal+event+timestamp (immutable → once)", () => {
    const a = failureRowToAlert({ proposal_id: "p1", event: "failed", at: NOW });
    assert.match(a.key, /^jobfail:p1:failed:/);
  });
});

describe("runFailedJobAlertPass", () => {
  it("honest-skips when disarmed", async () => {
    const sender = new FakeSender();
    const r = await runFailedJobAlertPass({}, NOW, EMPTY_ALERT_STATE, { db: fakeDb([]), sender });
    assert.equal(r.configured, false);
    assert.equal(sender.sent.length, 0);
  });
  it("alerts each failure row once, then dedupes on a repeat poll", async () => {
    const sender = new FakeSender();
    const rows = [
      { proposal_id: "p1", event: "execution_failed", at: NOW, title: "Deploy worker", domain: "system", risk_level: "medium" },
      { proposal_id: "p2", event: "failed", at: NOW, title: "Sync pack", domain: "ops" },
    ];
    const r1 = await runFailedJobAlertPass(ARMED, NOW, EMPTY_ALERT_STATE, { db: fakeDb(rows), sender });
    assert.equal(r1.configured, true);
    assert.equal(r1.sent, 2);
    assert.equal(sender.sent[0]!.chatId, "555");
    // same rows next poll → already-seen keys → nothing sent
    const r2 = await runFailedJobAlertPass(ARMED, NOW, r1.state, { db: fakeDb(rows), sender });
    assert.equal(r2.sent, 0);
    assert.equal(sender.sent.length, 2);
  });
});

// ── liveness alert pass ─────────────────────────────────────────────────────────────────────────

const verdict = (agentId: string, state: LivenessState, catalogStatus: LivenessVerdict["catalogStatus"]): LivenessVerdict => ({
  agentId,
  displayName: agentId,
  state,
  lastEvidenceAt: null,
  ageHours: 99,
  evidenceSource: "test",
  reason: `${agentId} ${state}`,
  catalogStatus,
});

const fleet = (verdicts: LivenessVerdict[]): FleetLiveness => ({
  generatedAt: NOW,
  verdicts,
  counts: { up: 0, stale: 0, down: 0, unknown: 0, assessed: verdicts.length },
  overall: "AMBER",
  overallReason: "test",
});

describe("livenessTransitionAlerts (pure edge-trigger)", () => {
  it("seeds silently on the first pass (prev=null → no alerts)", () => {
    assert.deepEqual(livenessTransitionAlerts(null, fleet([verdict("orchestrator", "down", "live")])), []);
  });
  it("alerts only on a worsening transition for a registry-expected agent", () => {
    const prev = fleet([verdict("orchestrator", "up", "live")]);
    const cur = fleet([verdict("orchestrator", "down", "live")]);
    const alerts = livenessTransitionAlerts(prev, cur);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.severity, "high");
    assert.match(alerts[0]!.key, /liveness:orchestrator:down/);
  });
  it("up→stale is medium; a steady down does NOT re-alert", () => {
    assert.equal(livenessTransitionAlerts(fleet([verdict("ops", "up", "live")]), fleet([verdict("ops", "stale", "live")]))[0]!.severity, "medium");
    assert.deepEqual(livenessTransitionAlerts(fleet([verdict("ops", "down", "live")]), fleet([verdict("ops", "down", "live")])), []);
  });
  it("emits an info recovery alert on down→up", () => {
    const alerts = livenessTransitionAlerts(fleet([verdict("ops", "down", "live")]), fleet([verdict("ops", "up", "live")]));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.severity, "info");
    assert.match(alerts[0]!.key, /recovered/);
  });
  it("does NOT alert 'unknown' or expected-dormant (unavailable) agents", () => {
    assert.deepEqual(livenessTransitionAlerts(fleet([verdict("x", "up", "live")]), fleet([verdict("x", "unknown", "live")])), []);
    assert.deepEqual(livenessTransitionAlerts(fleet([verdict("y", "up", "unavailable")]), fleet([verdict("y", "down", "unavailable")])), []);
  });
});

describe("runLivenessAlertPass", () => {
  it("honest-skips when disarmed (still returns no fleet change)", async () => {
    const sender = new FakeSender();
    const r = await runLivenessAlertPass({}, NOW, null, EMPTY_ALERT_STATE, { heartbeats: [], sender });
    assert.equal(r.configured, false);
    assert.equal(sender.sent.length, 0);
  });
  it("first armed pass seeds the fleet baseline and sends nothing", async () => {
    const sender = new FakeSender();
    const r = await runLivenessAlertPass(ARMED, NOW, null, EMPTY_ALERT_STATE, { heartbeats: [], sender });
    assert.equal(r.configured, true);
    assert.equal(r.sent, 0); // baseline established silently
    assert.ok(r.fleet, "returns the observed fleet to thread forward");
  });
});
