/**
 * tests/briefing-pack.test.ts — Live Organism P5: dossier → substance briefing pack.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBriefingPack, briefingPackToText } from "../src/rinnegan/briefing-pack.js";

const RESEARCH = [
  "---", "title: \"War economy\"", "type: research_dossier", "confidence: high", "---",
  "# Research Dossier — the war and its economic impact",
  "**Confidence: HIGH** · shape: landscape · 2026-06-10",
  "## Executive summary",
  "- answered 5/5 sub-question(s) from 67 source(s).",
  "## Key findings",
  "### What is worth pursuing first?",
  "",
  "Energy resilience first — distributed power, batteries, grid repair are urgent and fundable now.",
  "### Where are the gaps?",
  "",
  "Reconstruction finance, demining, defense production.",
  "## Sources",
  "- World Bank (url)",
  "- IEA (url)",
].join("\n");

const CAPABILITY = [
  "---", "title: \"Cap scout\"", "type: capability_dossier", "confidence: medium", "---",
  "# Capability Scout — markdown_editor",
  "**Mode: LIVE** · confidence: medium",
  "## Recommendation",
  "Top pick: vditor (MIT, value 10/10).",
  "## Candidates (2, ranked by value)",
  "### 1. vditor — 10/10",
  "- license: MIT · stale-risk: low",
  "- source: https://github.com/Vanessa219/vditor",
].join("\n");

describe("buildBriefingPack", () => {
  it("pulls research key findings (substance, not framing)", () => {
    const p = buildBriefingPack({ relPath: "x.md", title: "War economy", tags: ["research"], body: RESEARCH });
    assert.equal(p.type, "research_dossier");
    assert.equal(p.confidence, "high");
    assert.ok(p.keyFindings.length >= 2, "should extract findings");
    assert.match(p.keyFindings.join(" "), /Energy resilience first/);
    assert.match(p.verdict, /HIGH/);
    assert.equal(p.sourceCount, 67);
  });

  it("pulls capability recommendation + candidates", () => {
    const p = buildBriefingPack({ relPath: "y.md", title: "Cap scout", tags: ["beezulbub"], body: CAPABILITY });
    assert.equal(p.type, "capability_dossier");
    assert.match(p.recommendations.join(" "), /vditor/);
    assert.ok(p.keyFindings.length >= 1);
  });

  it("treats a non-dossier note as type 'note'", () => {
    const p = buildBriefingPack({ relPath: "v.md", title: "Vision", tags: ["doctrine"], body: "# Vision\nNorth star." });
    assert.equal(p.type, "note");
  });

  it("briefingPackToText carries title + substance, bounded", () => {
    const txt = briefingPackToText(buildBriefingPack({ relPath: "x.md", title: "War economy", tags: ["research"], body: RESEARCH }, { budget: 300 }));
    assert.match(txt, /War economy/);
    assert.match(txt, /Energy resilience/);
  });
});
