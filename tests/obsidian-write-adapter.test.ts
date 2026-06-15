/**
 * tests/obsidian-write-adapter.test.ts — the gated, LOCAL external adapter (obsidian-write).
 *
 * Hermetic (injected timestamp, fake ObsidianWriteStore, no fs/env/network): the writer is reached
 * ONLY through `runObsidianWrite` → `runExecutionAdapter`, so the fail-closed gate holds:
 *   • armed flag + file-not-present → writes once (executed),
 *   • file already present → idempotent no-op (no second write),
 *   • flag OFF (default) → refused (no write),
 *   • kill-switch overrides an armed flag,
 *   • dryRun never writes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runObsidianWrite } from "../src/execution/run-obsidian-write.js";
import type { ObsidianWriteStore } from "../src/execution/adapters/obsidian-write.js";
import { OBSIDIAN_WRITE_FLAG, OBSIDIAN_VAULT_ENV } from "../src/obsidian/obsidian-writer.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";
import type { ObsidianNoteProposal } from "../src/obsidian/obsidian-types.js";

const NOW = "2026-06-15T12:00:00.000Z";
const PROPOSAL = { id: "p-obs-1", status: "approved_for_execution" as const, expiresAt: null };
const NOTE: ObsidianNoteProposal = {
  title: "Canary Note",
  folder: "HartOS/Canary",
  noteType: "moc",
  tags: ["canary"],
  body: "hello world",
  sources: [],
  confidence: "low",
  reason: "execution-spine canary",
  createdAt: NOW,
};

function fakeStore(initialExists: boolean): { store: ObsidianWriteStore; calls: string[] } {
  const calls: string[] = [];
  let exists = initialExists;
  const store: ObsidianWriteStore = {
    async exists() {
      calls.push("exists");
      return exists;
    },
    async write() {
      calls.push("write");
      exists = true;
      return { written: true, reason: "note written to vault", relPath: "HartOS/Canary/canary-note.md", path: "/vault/HartOS/Canary/canary-note.md" };
    },
  };
  return { store, calls };
}

/** Suppress the framework audit console.log so test output stays pristine. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = orig;
  }
}

const ARMED = { [OBSIDIAN_WRITE_FLAG]: "true", [OBSIDIAN_VAULT_ENV]: "/vault" };

describe("obsidian-write adapter (gated local external write)", () => {
  it("writes the note when armed and the file does not exist", async () => {
    const { store, calls } = fakeStore(false);
    const res = await quiet(() => runObsidianWrite(PROPOSAL, { note: NOTE }, ARMED, { now: NOW, store }));
    assert.equal(res.executed, true);
    assert.equal(res.outcome?.ran, true);
    assert.ok(calls.includes("write"), "should have written");
  });

  it("is an idempotent no-op when the note already exists", async () => {
    const { store, calls } = fakeStore(true);
    const res = await quiet(() => runObsidianWrite(PROPOSAL, { note: NOTE }, ARMED, { now: NOW, store }));
    assert.equal(res.executed, false);
    assert.equal(calls.includes("write"), false, "must not overwrite an existing note");
  });

  it("refuses when the allowlist flag is OFF (default)", async () => {
    const { store, calls } = fakeStore(false);
    const env = { [OBSIDIAN_VAULT_ENV]: "/vault" }; // flag absent
    const res = await quiet(() => runObsidianWrite(PROPOSAL, { note: NOTE }, env, { now: NOW, store }));
    assert.equal(res.executed, false);
    assert.equal(res.precondition.allowed, false);
    assert.equal(calls.includes("write"), false);
  });

  it("the kill-switch overrides an armed flag", async () => {
    const { store, calls } = fakeStore(false);
    const env = { ...ARMED, [KILL_SWITCH_ENV]: "on" };
    const res = await quiet(() => runObsidianWrite(PROPOSAL, { note: NOTE }, env, { now: NOW, store }));
    assert.equal(res.executed, false);
    assert.equal(calls.includes("write"), false);
  });

  it("dryRun never writes", async () => {
    const { store, calls } = fakeStore(false);
    const res = await quiet(() => runObsidianWrite(PROPOSAL, { note: NOTE }, ARMED, { now: NOW, dryRun: true, store }));
    assert.equal(res.executed, false);
    assert.equal(calls.includes("write"), false);
  });
});
