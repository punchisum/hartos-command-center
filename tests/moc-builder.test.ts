/**
 * tests/moc-builder.test.ts — Live Organism P11: vault Maps-of-Content (additive, gated).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStandardMocs, buildMocProposal, vaultHygiene, STANDARD_MOCS } from "../src/obsidian/moc-builder.js";

const NOW = "2026-06-10T12:00:00Z";

describe("buildStandardMocs", () => {
  const mocs = buildStandardMocs(NOW);
  it("produces a Home lobby + a map per area, all noteType moc in HartOS/Maps", () => {
    assert.equal(mocs.length, STANDARD_MOCS.length);
    assert.ok(mocs.every((m) => m.noteType === "moc" && m.folder === "HartOS/Maps"));
    const home = mocs.find((m) => m.title === "Home")!;
    assert.match(home.body, /Area maps/);
    assert.match(home.body, /\[\[Research Dossiers MOC\]\]/);
  });
  it("is additive + honest — never claims to rewrite or delete", () => {
    assert.ok(buildStandardMocs(NOW).every((m) => /Additive only/.test(m.body)));
    assert.match(buildStandardMocs(NOW)[0].reason, /navigab/i);
  });
});

describe("buildMocProposal with a vault index", () => {
  it("links the actual notes when an index is supplied", () => {
    const moc = buildMocProposal(
      STANDARD_MOCS.find((m) => m.title === "Research Dossiers MOC")!,
      NOW,
      { "HartOS/Research Dossiers": [{ title: "War economy", relPath: "HartOS/Research Dossiers/x.md" }] },
    );
    assert.match(moc.body, /\[\[War economy\]\]/);
  });
});

describe("vaultHygiene", () => {
  it("reports covered areas + flags indexed folders without a map", () => {
    const h = vaultHygiene({ "HartOS/Research Dossiers": [], "Random/Unmapped": [] });
    assert.ok(h.foldersCovered.includes("HartOS/Research Dossiers"));
    assert.ok(h.uncoveredFolders.includes("Random/Unmapped"));
  });
});
