/**
 * tests/self-mod-armory-store.test.ts — P6 §6: the file-backed ArmoryStore (in-memory fake fs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileArmoryStore, type FsLike } from "../src/execution/self-mod-armory-store.js";

function memFs(seed?: string): FsLike & { dump: () => string | undefined } {
  let content: string | undefined = seed;
  return {
    exists: () => content !== undefined,
    read: () => { if (content === undefined) throw new Error("no file"); return content; },
    write: (_p, d) => { content = d; },
    dump: () => content,
  };
}

const PATH = "/state/self-mod.json";

describe("fileArmoryStore", () => {
  it("fresh (no file) → not disarmed, no last deploy", () => {
    const store = fileArmoryStore(PATH, memFs());
    assert.equal(store.isDisarmed(), false);
    assert.equal(store.lastAutoDeployAt(), null);
  });

  it("setDisarmed persists + isDisarmed reads it back", () => {
    const fs = memFs();
    const store = fileArmoryStore(PATH, fs);
    store.setDisarmed("a deploy failed");
    assert.equal(store.isDisarmed(), true);
    assert.match(fs.dump()!, /a deploy failed/);
  });

  it("clearDisarmed re-arms (isDisarmed false), preserving the deploy timestamp", () => {
    const fs = memFs();
    const store = fileArmoryStore(PATH, fs);
    store.recordAutoDeploy(12345);
    store.setDisarmed("x");
    store.clearDisarmed();
    assert.equal(store.isDisarmed(), false);
    assert.equal(store.lastAutoDeployAt(), 12345, "clearing the breaker must not wipe the rate timestamp");
  });

  it("recordAutoDeploy persists the timestamp", () => {
    const store = fileArmoryStore(PATH, memFs());
    store.recordAutoDeploy(999);
    assert.equal(store.lastAutoDeployAt(), 999);
  });

  it("a CORRUPT state file reads as disarmed (fail-closed)", () => {
    const store = fileArmoryStore(PATH, memFs("{not valid json"));
    assert.equal(store.isDisarmed(), true);
  });
});
