import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROSTER, selectPanel } from "../src/council/panel-selection.js";

describe("selectPanel", () => {
  it("no refiner → the default roster, capped at maxPanel", () => {
    // DEFAULT_ROSTER now has 6 entries (beezulbub added as capability-scout lens).
    // maxPanel=5 caps the default panel to the first 5; "legal" is the 6th and is dropped.
    assert.deepEqual(DEFAULT_ROSTER, ["research", "beezulbub", "cto", "financial", "ma", "legal"]);
    const panel = selectPanel({ goal: "build a CRM" });
    assert.deepEqual(panel, ["research", "beezulbub", "cto", "financial", "ma"]); // maxPanel=5 caps 6→5
  });
  it("refiner can trim + reorder", () => {
    const panel = selectPanel({ goal: "x" }, { refine: () => ["legal", "cto"] });
    assert.deepEqual(panel, ["legal", "cto"]);
  });
  it("refiner CANNOT introduce an unknown specialist (filtered)", () => {
    const panel = selectPanel({ goal: "x" }, { refine: () => ["cto", "astrologer", "legal"] });
    assert.deepEqual(panel, ["cto", "legal"]);
  });
  it("refiner returning [] → falls back to the deterministic roster (never an empty panel)", () => {
    // Falls back to the full roster, then caps at maxPanel=5 (drops "legal", the 6th entry).
    const panel = selectPanel({ goal: "x" }, { refine: () => [] });
    assert.deepEqual(panel, ["research", "beezulbub", "cto", "financial", "ma"]);
  });
  it("refiner throwing → deterministic roster, never throws", () => {
    // Falls back to the full roster, then caps at maxPanel=5 (drops "legal", the 6th entry).
    const panel = selectPanel({ goal: "x" }, { refine: () => { throw new Error("boom"); } });
    assert.deepEqual(panel, ["research", "beezulbub", "cto", "financial", "ma"]);
  });
  it("respects a smaller maxPanel", () => {
    const panel = selectPanel({ goal: "x" }, { maxPanel: 2 });
    assert.deepEqual(panel, ["research", "beezulbub"]);
  });
});
