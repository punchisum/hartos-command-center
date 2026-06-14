import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROSTER, selectPanel } from "../src/council/panel-selection.js";

describe("selectPanel", () => {
  it("no refiner → the full default roster (maxPanel=6 fits all 6)", () => {
    // DEFAULT_ROSTER has 6 entries (beezulbub added as capability-scout lens); maxPanel=6 fits them all.
    assert.deepEqual(DEFAULT_ROSTER, ["research", "beezulbub", "cto", "financial", "ma", "legal"]);
    const panel = selectPanel({ goal: "build a CRM" });
    assert.deepEqual(panel, ["research", "beezulbub", "cto", "financial", "ma", "legal"]);
  });
  it("refiner can trim + reorder", () => {
    const panel = selectPanel({ goal: "x" }, { refine: () => ["legal", "cto"] });
    assert.deepEqual(panel, ["legal", "cto"]);
  });
  it("refiner CANNOT introduce an unknown specialist (filtered)", () => {
    const panel = selectPanel({ goal: "x" }, { refine: () => ["cto", "astrologer", "legal"] });
    assert.deepEqual(panel, ["cto", "legal"]);
  });
  it("refiner returning [] → falls back to the full deterministic roster (never an empty panel)", () => {
    const panel = selectPanel({ goal: "x" }, { refine: () => [] });
    assert.deepEqual(panel, [...DEFAULT_ROSTER]);
  });
  it("refiner throwing → full deterministic roster, never throws", () => {
    const panel = selectPanel({ goal: "x" }, { refine: () => { throw new Error("boom"); } });
    assert.deepEqual(panel, [...DEFAULT_ROSTER]);
  });
  it("respects a smaller maxPanel", () => {
    const panel = selectPanel({ goal: "x" }, { maxPanel: 2 });
    assert.deepEqual(panel, ["research", "beezulbub"]);
  });
});
