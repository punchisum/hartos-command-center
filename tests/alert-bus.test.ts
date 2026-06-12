/**
 * tests/alert-bus.test.ts — the pure alert-bus core: gate, severity model, dedup, send path.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TelegramSender } from "../src/shared/types.js";
import {
  telegramNotifyConfig,
  cooldownMs,
  severityGlyph,
  formatAlert,
  dedupeAlerts,
  sendAlerts,
  EMPTY_ALERT_STATE,
  type Alert,
  type AlertBusState,
} from "../src/telegram/alert-bus.js";

const ARMED = { ALLOW_TELEGRAM_NOTIFY: "true", TELEGRAM_BOT_TOKEN: "123:abc", HARTOS_TELEGRAM_NOTIFY_CHAT_ID: "555" };
const MIN = 60_000;

class FakeSender implements TelegramSender {
  public sent: Array<{ chatId: string; text: string }> = [];
  async sendMessage(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
}

const alert = (key: string, severity: Alert["severity"]): Alert => ({ key, severity, title: `t:${key}`, body: "b", source: "s" });

describe("telegramNotifyConfig (shared bus gate)", () => {
  it("arms only with flag + token + chat id", () => {
    assert.equal(telegramNotifyConfig(ARMED).ok, true);
    assert.equal(telegramNotifyConfig(ARMED).chatId, "555");
    assert.equal(telegramNotifyConfig({ ...ARMED, ALLOW_TELEGRAM_NOTIFY: "no" }).ok, false);
    assert.equal(telegramNotifyConfig({ ...ARMED, TELEGRAM_BOT_TOKEN: "" }).ok, false);
    assert.equal(telegramNotifyConfig({ ...ARMED, HARTOS_TELEGRAM_NOTIFY_CHAT_ID: undefined }).ok, false);
  });
  it("prefers the alerts channel when asked, falling back to the notify chat", () => {
    assert.equal(telegramNotifyConfig({ ...ARMED, HARTOS_TELEGRAM_ALERTS_CHAT_ID: "999" }, true).chatId, "999");
    assert.equal(telegramNotifyConfig(ARMED, true).chatId, "555"); // no alerts chat → falls back
  });
});

describe("severity model", () => {
  it("cooldowns increase as severity decreases", () => {
    assert.ok(cooldownMs("critical") < cooldownMs("high"));
    assert.ok(cooldownMs("high") < cooldownMs("medium"));
    assert.ok(cooldownMs("medium") < cooldownMs("info"));
    assert.equal(cooldownMs("critical"), 30 * MIN);
    assert.equal(cooldownMs("info"), 24 * 60 * MIN);
  });
  it("formatAlert is plain text with a severity glyph + source", () => {
    const msg = formatAlert(alert("k", "critical"));
    assert.match(msg, /HartOS CRITICAL/);
    assert.match(msg, new RegExp(severityGlyph("critical")));
    assert.match(msg, /\(s\)$/);
  });
});

describe("dedupeAlerts (edge-trigger + cooldown + prune)", () => {
  it("sends an unseen key and records it", () => {
    const { toSend, nextState } = dedupeAlerts([alert("a", "high")], EMPTY_ALERT_STATE, 1_000_000);
    assert.equal(toSend.length, 1);
    assert.equal(nextState.lastSentAt["a"], 1_000_000);
  });
  it("suppresses a repeat within the cooldown, re-sends after it", () => {
    const t0 = 10_000_000;
    const s1 = dedupeAlerts([alert("a", "high")], EMPTY_ALERT_STATE, t0).nextState;
    // 30 min later — still within the 1h high cooldown → suppressed
    const r2 = dedupeAlerts([alert("a", "high")], s1, t0 + 30 * MIN);
    assert.equal(r2.toSend.length, 0);
    // 61 min later — past the 1h cooldown → re-sends
    const r3 = dedupeAlerts([alert("a", "high")], s1, t0 + 61 * MIN);
    assert.equal(r3.toSend.length, 1);
  });
  it("treats a worsened state as a NEW key (distinct keys both send)", () => {
    const t0 = 20_000_000;
    const s1 = dedupeAlerts([alert("liveness:x:stale", "medium")], EMPTY_ALERT_STATE, t0).nextState;
    const r2 = dedupeAlerts([alert("liveness:x:down", "high")], s1, t0 + MIN);
    assert.equal(r2.toSend.length, 1);
    assert.equal(r2.toSend[0]!.key, "liveness:x:down");
  });
  it("prunes entries older than the max cooldown (24h) to bound memory", () => {
    const old: AlertBusState = { lastSentAt: { stale: 0, fresh: 100_000_000 } };
    const { nextState } = dedupeAlerts([], old, 100_000_000); // 'stale' is >24h behind 'fresh'
    assert.equal(nextState.lastSentAt["stale"], undefined);
    assert.equal(nextState.lastSentAt["fresh"], 100_000_000);
  });
});

describe("sendAlerts", () => {
  it("sends the deduped survivors and threads the next state; never mutates input", async () => {
    const sender = new FakeSender();
    const input = EMPTY_ALERT_STATE;
    const r1 = await sendAlerts({ sender, chatId: "555", alerts: [alert("a", "high"), alert("b", "critical")], state: input, nowMs: 5_000_000 });
    assert.equal(r1.sent, 2);
    assert.equal(sender.sent.length, 2);
    assert.deepEqual(input, EMPTY_ALERT_STATE); // input untouched

    // second send of the same keys within cooldown → nothing
    const r2 = await sendAlerts({ sender, chatId: "555", alerts: [alert("a", "high")], state: r1.nextState, nowMs: 5_000_000 + MIN });
    assert.equal(r2.sent, 0);
    assert.equal(sender.sent.length, 2);
  });
});
