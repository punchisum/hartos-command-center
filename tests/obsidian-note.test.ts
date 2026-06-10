/**
 * tests/obsidian-note.test.ts — Obsidian meaning-layer: render, path, gated write, wolverine note.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderObsidianNote, notePath, slugify } from "../src/obsidian/obsidian-note.js";
import { writeObsidianNote, OBSIDIAN_VAULT_ENV, OBSIDIAN_WRITE_FLAG } from "../src/obsidian/obsidian-writer.js";
import { wolverineAuditNote } from "../src/obsidian/obsidian-from-wolverine.js";
import type { ObsidianNoteProposal } from "../src/obsidian/obsidian-types.js";
import type { WolverineReport } from "../src/wolverine/wolverine-types.js";

const NOW = "2026-06-10T08:00:00.000Z";

function note(over: Partial<ObsidianNoteProposal> = {}): ObsidianNoteProposal {
  return {
    title: "Test Note: Recovery!",
    folder: "HartOS/Tests",
    noteType: "wolverine_audit_summary",
    tags: ["hartos", "test"],
    body: "# Hello\n\nbody text",
    sources: ["unit:test"],
    confidence: "high",
    reason: "test",
    reviewBy: null,
    relatedAgents: ["Wolverine"],
    relatedProposals: [],
    createdAt: NOW,
    ...over,
  };
}

describe("renderObsidianNote / paths", () => {
  it("renders YAML frontmatter + body", () => {
    const md = renderObsidianNote(note());
    assert.ok(md.startsWith("---\n"));
    assert.match(md, /type: wolverine_audit_summary/);
    assert.match(md, /tags: \["hartos", "test"\]/);
    assert.match(md, /generated_by: HartOS/);
    assert.match(md, /body text/);
  });
  it("slugifies the filename safely", () => {
    assert.equal(slugify("Test Note: Recovery!"), "test-note-recovery");
    assert.equal(notePath(note()), "HartOS/Tests/test-note-recovery.md");
  });
});

describe("writeObsidianNote — gated", () => {
  it("does not write without a configured vault", async () => {
    const r = await writeObsidianNote(note(), {});
    assert.equal(r.written, false);
  });
  it("does not write when the flag is off", async () => {
    const r = await writeObsidianNote(note(), { [OBSIDIAN_VAULT_ENV]: "/tmp/x" });
    assert.equal(r.written, false);
  });
  it("writes the .md when vault + flag are set", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hartos-vault-"));
    try {
      const r = await writeObsidianNote(note(), { [OBSIDIAN_VAULT_ENV]: dir, [OBSIDIAN_WRITE_FLAG]: "true" });
      assert.equal(r.written, true);
      const content = await readFile(r.path!, "utf8");
      assert.match(content, /type: wolverine_audit_summary/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("wolverineAuditNote", () => {
  it("builds a wolverine_audit_summary note from a report", () => {
    const report: WolverineReport = {
      generatedAt: NOW, verdict: "AMBER", verdictReason: "1 high-severity issue",
      findingCount: 1, bySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
      topRisks: [], repairQueue: [], note: "x",
    };
    const n = wolverineAuditNote(report, NOW);
    assert.equal(n.noteType, "wolverine_audit_summary");
    assert.equal(n.folder, "HartOS/Wolverine Audits");
    assert.match(n.body, /Verdict: AMBER/);
    assert.ok(n.tags.includes("amber"));
  });
});
