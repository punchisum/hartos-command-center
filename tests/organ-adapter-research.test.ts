import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchOrgan } from "../src/organs/adapters/research.js";

const NOW = "2026-06-14T00:00:00Z";

test("researchOrgan declares the contracted identity + arming gate", () => {
  assert.equal(researchOrgan.organId, "research");
  assert.equal(researchOrgan.armingFlag, "HARTOS_RESEARCH_GATHER");
  assert.equal(typeof researchOrgan.run, "function");
});

test("run() always returns a well-formed OrganRunResult shape", async () => {
  const res = await researchOrgan.run({}, NOW);

  assert.equal(typeof res.ok, "boolean");
  // outputRef is a SOT-readable handle (string) or null — never undefined.
  assert.ok(res.outputRef === null || typeof res.outputRef === "string");
  assert.equal(typeof res.summary, "string");
  assert.ok(res.summary.length > 0 && res.summary.length < 300);
  if (res.detail !== undefined) {
    assert.equal(typeof res.detail, "object");
  }
});

test("run() returns an HONEST PARTIAL ok:false when no dossiers exist (no fabrication)", async () => {
  const empty = await mkdtemp(join(tmpdir(), "hartos-research-empty-"));
  try {
    // Point at a dir with no research-reports/ subdir ⇒ honest idle PARTIAL, never a faked success.
    const res = await researchOrgan.run({ HARTOS_RESEARCH_REPORTS_DIR: empty }, NOW);
    assert.equal(res.ok, false);
    assert.equal(res.outputRef, null);
    assert.match(res.summary, /research idle/i);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("run() reports the newest existing dossier as ok:true with its path + title", async () => {
  const root = await mkdtemp(join(tmpdir(), "hartos-research-full-"));
  try {
    const reports = join(root, "research-reports");
    await mkdir(reports, { recursive: true });
    // Two dossiers; the newer one (written second) must win and its title must be extracted.
    await writeFile(join(reports, "old-2026-06-10.md"), "# Old Dossier — stale topic\n\nbody\n", "utf8");
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(reports, "new-2026-06-14.md"), "# Fresh Dossier — current topic\n\nbody\n", "utf8");

    const res = await researchOrgan.run({ HARTOS_RESEARCH_REPORTS_DIR: root }, NOW);
    assert.equal(res.ok, true);
    assert.ok(typeof res.outputRef === "string" && res.outputRef!.includes("new-2026-06-14.md"));
    assert.match(res.summary, /Fresh Dossier/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run() never throws, even on a junk env and an unparseable clock", async () => {
  await assert.doesNotReject(async () => {
    await researchOrgan.run({ HARTOS_RESEARCH_GATHER: "" }, NOW);
  });
  await assert.doesNotReject(async () => {
    await researchOrgan.run({ HARTOS_RESEARCH_REPORTS_DIR: "\0::invalid::path" }, "not-a-date");
  });
});
