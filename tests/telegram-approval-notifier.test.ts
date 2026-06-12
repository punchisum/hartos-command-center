/**
 * tests/telegram-approval-notifier.test.ts — the outbound approval notifier (HartOS → Hart).
 *
 * Pins the gate (fail-closed unless all three env pieces present), the digest formatting, the
 * dedupe-across-cycles, and the live pass's honest-skip / send-once behaviour with a fake sender
 * and a fake DB — no network, no token.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TelegramSender } from "../src/shared/types.js";
import {
  telegramNotifyConfig,
  formatApprovalDigest,
  selectUnnotified,
  notifyPendingApprovals,
  riskGlyph,
  type PendingProposalLite,
} from "../src/telegram/approval-notifier.js";
import { runApprovalNotifyPass } from "../src/telegram/run-approval-notify.js";

const ARMED = {
  ALLOW_TELEGRAM_NOTIFY: "true",
  TELEGRAM_BOT_TOKEN: "123:abc",
  HARTOS_TELEGRAM_NOTIFY_CHAT_ID: "555",
};

class FakeSender implements TelegramSender {
  public sent: Array<{ chatId: string; text: string }> = [];
  async sendMessage(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
}

const PENDING: PendingProposalLite[] = [
  { id: "p1", title: "Wolverine fix: disarm stray ALLOW_EXEC", riskLevel: "high", domain: "system" },
  { id: "p2", title: "Research: GLP-1 coaching protocols", riskLevel: "low", domain: "research" },
];

describe("telegramNotifyConfig (fail-closed gate)", () => {
  it("is armed only when flag + token + chat id are all present", () => {
    assert.equal(telegramNotifyConfig(ARMED).ok, true);
    assert.equal(telegramNotifyConfig(ARMED).chatId, "555");
  });
  it("refuses when the flag is off", () => {
    const c = telegramNotifyConfig({ ...ARMED, ALLOW_TELEGRAM_NOTIFY: "false" });
    assert.equal(c.ok, false);
    assert.match(c.reason!, /disarmed/);
  });
  it("refuses when the token or chat id is missing", () => {
    assert.equal(telegramNotifyConfig({ ...ARMED, TELEGRAM_BOT_TOKEN: "" }).ok, false);
    assert.equal(telegramNotifyConfig({ ...ARMED, HARTOS_TELEGRAM_NOTIFY_CHAT_ID: undefined }).ok, false);
  });
});

describe("formatApprovalDigest", () => {
  it("names the proposals with risk glyphs + a singular/plural header + where to act", () => {
    const one = formatApprovalDigest([PENDING[0]!]);
    assert.match(one, /1 proposal awaiting/);
    assert.match(one, /Synapses/);
    const many = formatApprovalDigest(PENDING);
    assert.match(many, /2 proposals awaiting/);
    assert.match(many, /🔴/); // high
    assert.match(many, /🟢/); // low
    assert.match(many, /Wolverine fix/);
  });
  it("caps the list and reports the overflow", () => {
    const big: PendingProposalLite[] = Array.from({ length: 11 }, (_, i) => ({ id: `q${i}`, title: `t${i}` }));
    const msg = formatApprovalDigest(big);
    assert.match(msg, /and 3 more/); // 11 total, 8 shown
  });
  it("riskGlyph maps severities", () => {
    assert.equal(riskGlyph("high"), "🔴");
    assert.equal(riskGlyph("medium"), "🟡");
    assert.equal(riskGlyph(undefined), "🟢");
  });
});

describe("selectUnnotified + notifyPendingApprovals (dedupe)", () => {
  it("only returns proposals not already notified", () => {
    const fresh = selectUnnotified(PENDING, new Set(["p1"]));
    assert.deepEqual(fresh.map((p) => p.id), ["p2"]);
  });
  it("sends one digest and marks them; a second pass with no new pendings sends nothing", async () => {
    const sender = new FakeSender();
    const first = await notifyPendingApprovals({ sender, chatId: "555", pending: PENDING, notifiedIds: new Set() });
    assert.equal(first.sent, true);
    assert.equal(first.count, 2);
    assert.equal(sender.sent.length, 1);

    const second = await notifyPendingApprovals({ sender, chatId: "555", pending: PENDING, notifiedIds: first.notified });
    assert.equal(second.sent, false);
    assert.equal(sender.sent.length, 1); // no second send
  });
  it("never mutates the input set", async () => {
    const sender = new FakeSender();
    const input = new Set<string>();
    await notifyPendingApprovals({ sender, chatId: "555", pending: PENDING, notifiedIds: input });
    assert.equal(input.size, 0);
  });
});

describe("runApprovalNotifyPass (live wiring, injected fakes)", () => {
  const fakeDb = (rows: unknown[]) => ({
    async query() {
      return { rows };
    },
    async close() {},
  });

  it("honest-skips when disarmed (sends nothing, configured:false)", async () => {
    const sender = new FakeSender();
    const r = await runApprovalNotifyPass({}, new Set(), { db: fakeDb([]), sender });
    assert.equal(r.configured, false);
    assert.match(r.reason!, /disarmed/);
    assert.equal(sender.sent.length, 0);
  });

  it("pings once for fresh pending rows, then dedupes on the next pass", async () => {
    const sender = new FakeSender();
    const rows = [
      { id: "p1", title: "Wolverine fix", risk_level: "high", domain: "system" },
      { id: "p2", title: "Research dossier", risk_level: "low", domain: "research" },
    ];
    const first = await runApprovalNotifyPass(ARMED, new Set(), { db: fakeDb(rows), sender });
    assert.equal(first.configured, true);
    assert.equal(first.sent, true);
    assert.equal(first.count, 2);
    assert.equal(sender.sent[0]!.chatId, "555");

    const second = await runApprovalNotifyPass(ARMED, first.notified, { db: fakeDb(rows), sender });
    assert.equal(second.sent, false);
    assert.equal(sender.sent.length, 1);
  });

  it("prunes the notified-set to currently-pending ids (re-announces a returning proposal)", async () => {
    const sender = new FakeSender();
    const rowsP1 = [{ id: "p1", title: "Fix", risk_level: "high", domain: "system" }];
    const r1 = await runApprovalNotifyPass(ARMED, new Set(), { db: fakeDb(rowsP1), sender });
    assert.equal(r1.sent, true);
    // p1 leaves pending (approved) → empty pending; the set prunes p1 out.
    const r2 = await runApprovalNotifyPass(ARMED, r1.notified, { db: fakeDb([]), sender });
    assert.equal(r2.notified.has("p1"), false);
    // p1 returns to pending → announced again.
    const r3 = await runApprovalNotifyPass(ARMED, r2.notified, { db: fakeDb(rowsP1), sender });
    assert.equal(r3.sent, true);
    assert.equal(sender.sent.length, 2);
  });
});
