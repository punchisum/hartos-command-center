import { test } from "node:test";
import assert from "node:assert/strict";
import { runOrgan, organArmed, type OrganAdapter } from "../src/organs/organ-supervisor.js";

function fakeDb() {
  const calls: unknown[][] = [];
  return {
    calls,
    query: async (t: string, p?: unknown[]) => {
      calls.push([t, p]);
      return { rows: [] as unknown[] };
    },
  };
}
let perf = 0;
const perfNow = () => (perf += 10);

const noopAdapter = (over: Partial<OrganAdapter> = {}): OrganAdapter => ({
  organId: "x",
  armingFlag: null,
  run: async () => ({ ok: true, outputRef: "r", summary: "s" }),
  ...over,
});

test("disarmed organ writes a skip beat and never runs", async () => {
  let ran = false;
  const a = noopAdapter({
    armingFlag: "FLAG_OFF",
    run: async () => {
      ran = true;
      return { ok: true, outputRef: "r", summary: "s" };
    },
  });
  const db = fakeDb();
  const res = await runOrgan(db, a, {}, "2026-06-14T00:00:00Z", perfNow);
  assert.equal(ran, false);
  assert.equal(res.ok, false);
  assert.match(String(db.calls[0][0]), /insert into public\.organ_runs/);
  assert.equal((db.calls[0][1] as unknown[])[3], true); // disarmed=true
});

test("armed organ runs and records ok with output_ref", async () => {
  const a = noopAdapter({ organId: "y", armingFlag: null, run: async () => ({ ok: true, outputRef: "ref", summary: "did it" }) });
  const db = fakeDb();
  const res = await runOrgan(db, a, {}, "2026-06-14T00:00:00Z", perfNow);
  assert.equal(res.ok, true);
  assert.equal(res.outputRef, "ref");
  assert.equal((db.calls[0][1] as unknown[])[3], false); // disarmed=false
});

test("a throwing adapter is captured as ok:false, not propagated", async () => {
  const a = noopAdapter({
    organId: "z",
    armingFlag: null,
    run: async () => {
      throw new Error("boom");
    },
  });
  const db = fakeDb();
  const res = await runOrgan(db, a, {}, "2026-06-14T00:00:00Z", perfNow);
  assert.equal(res.ok, false);
  assert.match(res.summary, /threw: boom/);
});

test("organArmed reads truthy env, defaults closed", () => {
  const a = noopAdapter({ armingFlag: "F" });
  assert.equal(organArmed(a, { F: "on" }), true);
  assert.equal(organArmed(a, { F: "true" }), true);
  assert.equal(organArmed(a, {}), false);
  assert.equal(organArmed(noopAdapter({ armingFlag: null }), {}), true);
});
