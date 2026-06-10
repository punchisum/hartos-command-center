/**
 * tests/research-dossier-note.test.ts — the dossier → gated Obsidian note (knowledge loop output).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { researchDossierNote } from "../src/research/research-dossier-note.js";
import { synthesizeResearch, type GatheredSource } from "../src/research/research-synthesis.js";
import { planResearch } from "../src/research/research-planner.js";

const NOW = "2026-06-10T12:00:00Z";
const PLAN = planResearch("compare Postgres and SQLite for an edge app");

describe("researchDossierNote", () => {
  it("renders a research_dossier note carrying findings, knowledge, sources + the dossier confidence", () => {
    const gathered: GatheredSource[] = [
      { ref: "pg-docs", title: "Postgres Docs", content: "Postgres is a client-server RDBMS.", answers: [0], asOf: NOW },
      { ref: "edge-guide", title: "Edge Guide", content: "SQLite is embedded, ideal for edge reads.", answers: [0], asOf: NOW },
    ];
    const dossier = synthesizeResearch(PLAN, gathered, { now: NOW });
    const note = researchDossierNote(dossier, NOW);

    assert.equal(note.noteType, "research_dossier");
    assert.equal(note.folder, "HartOS/Research Dossiers");
    assert.deepEqual(note.sources.sort(), ["edge-guide", "pg-docs"]);
    assert.equal(note.createdAt, NOW);
    assert.ok(note.relatedAgents?.includes("Research"));
    assert.match(note.body, /Reusable knowledge \(usable across HartOS\)/);
    assert.match(note.body, /## Key findings/);
  });

  it("is honest when the dossier is empty — surfaces open questions, not fake findings", () => {
    const dossier = synthesizeResearch(PLAN, [], { now: NOW });
    const note = researchDossierNote(dossier, NOW);
    assert.equal(note.confidence, "low"); // unknown ⇒ low, never laundered up
    assert.match(note.body, /No findings gathered yet/);
    assert.match(note.body, /Open questions/);
  });
});
