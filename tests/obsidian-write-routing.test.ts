/**
 * tests/obsidian-write-routing.test.ts — wiring the obsidian-write adapter into the gated spine.
 *
 * Proves (1) the host executor reconstructs an obsidian-write MutationCommand from an APPROVED
 * proposal (route + payload.note), skipping when the store is absent or the note is missing, and
 * (2) the unified dispatcher routes an obsidian-write command to the gated adapter and projects a
 * §13 delta ONLY when a write actually executed. Hermetic: fake store, injected now, no fs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commandFromApprovedProposal } from "../src/execution/approved-executor.js";
import { dispatchMutation } from "../src/execution/execution-dispatch.js";
import { ADAPTER_ROUTE_KEY } from "../src/cockpit/suggestions/suggestion-to-mutation.js";
import { EXECUTABLE_FROM } from "../src/doctrine/execution-gate.js";
import { OBSIDIAN_WRITE_FLAG, OBSIDIAN_VAULT_ENV } from "../src/obsidian/obsidian-writer.js";
import type { ObsidianWriteStore } from "../src/execution/adapters/obsidian-write.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";
import type { ObsidianNoteProposal } from "../src/obsidian/obsidian-types.js";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const NOTE: ObsidianNoteProposal = {
  title: "Spine Canary",
  folder: "HartOS/Canary",
  noteType: "moc",
  tags: ["canary"],
  body: "wired through the spine",
  sources: ["execution:canary"],
  confidence: "low",
  reason: "execution-spine canary",
  createdAt: NOW.toISOString(),
};

function fakeStore(initialExists = false): { store: ObsidianWriteStore; calls: string[] } {
  const calls: string[] = [];
  let exists = initialExists;
  const store: ObsidianWriteStore = {
    async exists() { calls.push("exists"); return exists; },
    async write() { calls.push("write"); exists = true; return { written: true, reason: "ok", relPath: "HartOS/Canary/spine-canary.md", path: "/vault/HartOS/Canary/spine-canary.md" }; },
  };
  return { store, calls };
}

function obsidianProposal(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  return {
    id: "p-obs", domain: "research", actionType: "research_plan",
    title: "File canary note", description: "d", sourceIntent: "mutate",
    proposedPayload: { [ADAPTER_ROUTE_KEY]: { adapterId: "obsidian-write", tier: "T3" }, note: NOTE },
    expectedEffect: "e", riskLevel: "low", requiredApproval: "Hart",
    expiresAt: null, safetyNotes: [], blockedReason: "", dryRunResult: null, executable: false,
    tier: "T3", targetId: "obs", createdAt: "2026-06-15T11:00:00.000Z",
    status: EXECUTABLE_FROM, updatedAt: NOW.toISOString(), auditEvents: [],
    ...over,
  } as ProposalQueueItem;
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = orig; }
}

describe("commandFromApprovedProposal — obsidian-write", () => {
  it("reconstructs an obsidian-write command from an approved proposal", () => {
    const { store } = fakeStore();
    const built = commandFromApprovedProposal(obsidianProposal(), { obsidianWrite: store });
    assert.ok(!("skip" in built), "skip" in built ? built.skip : "");
    if ("skip" in built) return;
    assert.equal(built.adapterId, "obsidian-write");
    assert.equal(built.proposal.id, "p-obs");
    if (built.adapterId === "obsidian-write") {
      assert.equal(built.target.note.title, "Spine Canary");
      assert.equal(built.target.note.folder, "HartOS/Canary");
    }
  });

  it("skips when no obsidian store is injected", () => {
    const built = commandFromApprovedProposal(obsidianProposal(), {});
    assert.ok("skip" in built && /obsidian/i.test(built.skip));
  });

  it("skips when the note payload is missing", () => {
    const { store } = fakeStore();
    const built = commandFromApprovedProposal(
      obsidianProposal({ proposedPayload: { [ADAPTER_ROUTE_KEY]: { adapterId: "obsidian-write", tier: "T3" } } }),
      { obsidianWrite: store },
    );
    assert.ok("skip" in built && /note/i.test(built.skip));
  });
});

describe("dispatchMutation — obsidian-write", () => {
  it("routes to the gated adapter and projects a delta when armed + file absent", async () => {
    const { store, calls } = fakeStore(false);
    const env = { [OBSIDIAN_WRITE_FLAG]: "true", [OBSIDIAN_VAULT_ENV]: "/vault" };
    const res = await quiet(() =>
      dispatchMutation(
        { adapterId: "obsidian-write", proposal: { id: "p-obs", status: EXECUTABLE_FROM, expiresAt: null }, target: { note: NOTE }, store },
        env,
        { now: NOW },
      ),
    );
    assert.equal(res.result.executed, true);
    assert.notEqual(res.delta, null, "a real write must project a §13 delta");
    assert.ok(calls.includes("write"));
  });

  it("projects NO delta when the flag is OFF (gate refuses)", async () => {
    const { store, calls } = fakeStore(false);
    const env = { [OBSIDIAN_VAULT_ENV]: "/vault" }; // flag absent
    const res = await quiet(() =>
      dispatchMutation(
        { adapterId: "obsidian-write", proposal: { id: "p-obs", status: EXECUTABLE_FROM, expiresAt: null }, target: { note: NOTE }, store },
        env,
        { now: NOW },
      ),
    );
    assert.equal(res.result.executed, false);
    assert.equal(res.delta, null);
    assert.equal(calls.includes("write"), false);
  });
});
