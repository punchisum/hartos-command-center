/**
 * tests/code-build-core.test.ts — the verify-looped build control plane.
 * Twice-gated; accepts ONLY on a green verify; feeds verify errors back on retry; withholds the
 * artifact (status failed) when no attempt verifies. Never claims success on unverified code.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runCodeBuild,
  codeBuildArmed,
  CODE_BUILD_FLAG,
  CODE_BUILD_CONFIRM,
  type GeneratedFile,
  type GenerateInput,
} from "../src/builder/code-build-core.js";

const ARMED = { [CODE_BUILD_FLAG]: "true", [CODE_BUILD_CONFIRM]: "true" } as const;
const ok = (files: GeneratedFile[]) => async () => ({ ok: true, errors: [] });
const greenVerify = async () => ({ ok: true, errors: [] });

describe("code-build control plane", () => {
  it("requires BOTH keys — one alone is disarmed", () => {
    assert.equal(codeBuildArmed({}), false);
    assert.equal(codeBuildArmed({ [CODE_BUILD_FLAG]: "true" }), false);
    assert.equal(codeBuildArmed({ [CODE_BUILD_CONFIRM]: "true" }), false);
    assert.equal(codeBuildArmed(ARMED), true);
  });

  it("disarmed: generates nothing", async () => {
    let called = false;
    const res = await runCodeBuild({
      request: "build a thing",
      env: {},
      generate: async () => {
        called = true;
        return { files: [{ path: "a.ts", content: "" }] };
      },
      verify: greenVerify,
    });
    assert.equal(res.status, "disarmed");
    assert.equal(called, false);
  });

  it("empty request is rejected before any work", async () => {
    const res = await runCodeBuild({ request: "  ", env: ARMED, generate: async () => ({ files: [] }), verify: greenVerify });
    assert.equal(res.status, "empty");
  });

  it("green on the first attempt ⇒ verified, 1 attempt", async () => {
    const res = await runCodeBuild({
      request: "build x",
      env: ARMED,
      generate: async () => ({ files: [{ path: "x.ts", content: "export const x = 1;" }] }),
      verify: greenVerify,
    });
    assert.equal(res.status, "verified");
    assert.equal(res.attempts, 1);
    assert.equal(res.files.length, 1);
  });

  it("feeds verify errors back and self-corrects: fail, fail, green ⇒ verified at attempt 3", async () => {
    const seenPriorErrors: string[][] = [];
    let n = 0;
    const res = await runCodeBuild({
      request: "build x",
      env: ARMED,
      maxAttempts: 3,
      generate: async (input: GenerateInput) => {
        seenPriorErrors.push(input.priorErrors);
        n += 1;
        return { files: [{ path: "x.ts", content: `attempt ${n}` }] };
      },
      verify: async () => (n >= 3 ? { ok: true, errors: [] } : { ok: false, errors: [`TS error at attempt ${n}`] }),
    });
    assert.equal(res.status, "verified");
    assert.equal(res.attempts, 3);
    assert.deepEqual(seenPriorErrors[0], [], "first attempt has no prior errors");
    assert.deepEqual(seenPriorErrors[1], ["TS error at attempt 1"], "second attempt receives the first's errors");
    assert.deepEqual(seenPriorErrors[2], ["TS error at attempt 2"]);
  });

  it("never green within maxAttempts ⇒ failed, artifact WITHHELD (not claimed verified)", async () => {
    const res = await runCodeBuild({
      request: "build x",
      env: ARMED,
      maxAttempts: 2,
      generate: async () => ({ files: [{ path: "x.ts", content: "bad" }] }),
      verify: async () => ({ ok: false, errors: ["error TS2304: cannot find name"] }),
    });
    assert.equal(res.status, "failed");
    assert.equal(res.attempts, 2);
    assert.notEqual(res.status, "verified");
    assert.ok(res.errors.length > 0, "carries the last verify errors");
  });

  it("a generator that produces no files counts the attempt and feeds back honestly", async () => {
    const res = await runCodeBuild({
      request: "build x",
      env: ARMED,
      maxAttempts: 1,
      generate: async () => ({ files: [] }),
      verify: greenVerify,
    });
    assert.equal(res.status, "failed");
    assert.match(res.lines.join("\n"), /produced no files/);
  });
});
