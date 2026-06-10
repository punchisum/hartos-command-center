/**
 * tests/rinnegan-compiler.test.ts — Rinnegan context compiler (pure).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileContext, toBriefing } from "../src/rinnegan/rinnegan-compiler.js";
import type { RinneganInputs } from "../src/rinnegan/rinnegan-types.js";

const NOW = "2026-06-10T00:00:00.000Z";

const inputs = (over: Partial<RinneganInputs> = {}): RinneganInputs => ({ intent: "anything urgent in ops", now: NOW, ...over });

describe("compileContext", () => {
  it("selects intent-relevant notes and ignores irrelevant ones", () => {
    const ctx = compileContext(inputs({
      notes: [
        { relPath: "Roadmaps & Plans/ops-plan.md", title: "Ops Backlog Plan", tags: ["ops", "plan"], body: "How we triage urgent ops cards." },
        { relPath: "Fitness Agent/recovery.md", title: "Recovery Doctrine", tags: ["fitness"], body: "HRV and sleep guidance." },
      ],
    }));
    const titles = ctx.items.map((i) => i.title);
    assert.ok(titles.includes("Ops Backlog Plan"));
    assert.ok(!titles.includes("Recovery Doctrine"));
  });

  it("classifies kinds + ranks facts highly", () => {
    const ctx = compileContext(inputs({
      facts: [{ label: "Verdict", value: "AMBER — 2 waiting on Hart", source: "ops" }],
      notes: [{ relPath: "Vision & Doctrine/doctrine.md", title: "Ops Doctrine", tags: ["doctrine"], body: "ops urgent handling doctrine" }],
    }));
    assert.equal(ctx.items[0]!.kind, "fact"); // facts (×1.0) lead
    assert.ok(ctx.items.some((i) => i.kind === "doctrine"));
  });

  it("flags + down-weights stale notes (honesty floor)", () => {
    const ctx = compileContext(inputs({
      notes: [{ relPath: "Roadmaps & Plans/old.md", title: "Old Ops Plan", tags: ["ops"], body: "urgent ops", reviewBy: "2020-01-01T00:00:00.000Z" }],
    }));
    assert.equal(ctx.items[0]!.freshness, "STALE (review overdue)");
    assert.match(ctx.note, /STALE/);
  });

  it("caps items and renders a briefing", () => {
    const facts = Array.from({ length: 20 }, (_, i) => ({ label: `f${i}`, value: `v${i}`, source: "x" }));
    const ctx = compileContext(inputs({ facts }), { maxItems: 5 });
    assert.equal(ctx.items.length, 5);
    assert.match(toBriefing(ctx), /Compiled briefing for/);
  });

  it("empty inputs → honest empty context", () => {
    const ctx = compileContext(inputs());
    assert.equal(ctx.items.length, 0);
    assert.equal(toBriefing(ctx), "");
  });
});
