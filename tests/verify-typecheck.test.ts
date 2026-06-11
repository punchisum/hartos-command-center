/**
 * tests/verify-typecheck.test.ts — the code-build verifier's plumbing (injected runner; no spawn).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeTypecheckVerifier, parseTypecheckErrors, safeRelPath, type TypecheckRunner } from "../src/builder/verify-typecheck.js";

describe("typecheck verifier plumbing", () => {
  it("safeRelPath strips absolute roots and parent traversal (no escape)", () => {
    assert.equal(safeRelPath("C:/Windows/system32/x.ts"), "Windows/system32/x.ts");
    assert.equal(safeRelPath("/etc/passwd"), "etc/passwd");
    assert.equal(safeRelPath("../../secret.ts"), "secret.ts");
    assert.equal(safeRelPath("a/../../b.ts"), "a/b.ts");
  });

  it("parseTypecheckErrors picks the TSxxxx lines", () => {
    const out = "x.ts(1,1): error TS2304: Cannot find name 'foo'.\nsome noise\ny.ts(2,2): error TS1005: ';' expected.";
    const errs = parseTypecheckErrors(out);
    assert.equal(errs.length, 2);
    assert.match(errs[0]!, /TS2304/);
  });

  it("verifier returns ok when the injected runner passes", async () => {
    const runner: TypecheckRunner = async () => ({ ok: true, output: "" });
    const verify = makeTypecheckVerifier({ runner });
    const r = await verify([{ path: "x.ts", content: "export const x = 1;" }]);
    assert.deepEqual(r, { ok: true, errors: [] });
  });

  it("verifier surfaces parsed errors when the runner fails", async () => {
    const runner: TypecheckRunner = async () => ({ ok: false, output: "x.ts(1,1): error TS2304: Cannot find name 'foo'." });
    const verify = makeTypecheckVerifier({ runner });
    const r = await verify([{ path: "x.ts", content: "foo" }]);
    assert.equal(r.ok, false);
    assert.match(r.errors[0]!, /TS2304/);
  });

  it("no files ⇒ not ok (nothing to verify is not a pass)", async () => {
    const verify = makeTypecheckVerifier({ runner: async () => ({ ok: true, output: "" }) });
    const r = await verify([]);
    assert.equal(r.ok, false);
  });
});
