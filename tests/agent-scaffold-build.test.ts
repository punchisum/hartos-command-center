/**
 * tests/agent-scaffold-build.test.ts
 *
 * Phase 18A — controlled execution / PR mode (LOCAL-ONLY). Proves, hermetically (Factory call +
 * git injected; a fetch that throws installed): a real local branch + commit + PR-prep bundle are
 * produced; the executor NEVER pushes or makes a network call; generated secrets/forbidden files
 * and workdir-escapes fail closed; the two-key gate is enforced; rollback is a clean local delete;
 * and the proposal is not advanced to executed.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveProposal,
  markSimulatedApproved,
  approveForExecution,
  readProposal,
  generateProposals,
  type ProposalContext,
} from "../src/cockpit/proposals/index.js";
import {
  runLocalScaffoldBuild,
  rollbackLocalScaffold,
  ScaffoldBuildPreconditionError,
  LOCAL_SCAFFOLD_GATE,
  type ScaffoldFn,
  type LocalGitOps,
} from "../src/execution/index.js";

const NOW = "2026-06-05T12:00:00.000Z";
const OPEN = { [LOCAL_SCAFFOLD_GATE]: "true" };

// ── Hermetic doubles ─────────────────────────────────────────────────────────

/** A fake Factory scaffold that writes a couple of innocuous template-like files into outDir. */
function fakeScaffold(extra?: (outDir: string) => Promise<string[]>): ScaffoldFn {
  return async ({ outDir }) => {
    await mkdir(path.join(outDir, "src"), { recursive: true });
    await writeFile(path.join(outDir, "agent.yaml"), "name: test-agent\nversion: 0.1.0\n", "utf8");
    await writeFile(path.join(outDir, "src", "index.ts"), "export const agent = 'test-agent';\n", "utf8");
    await writeFile(path.join(outDir, ".env.example"), "GITHUB_TOKEN=\n", "utf8");
    const files = ["agent.yaml", "src/index.ts", ".env.example"];
    if (extra) files.push(...(await extra(outDir)));
    return { files: files.sort() };
  };
}

/** A fake git that records the call order and physically has NO push (interface-enforced). */
function recordingGit(): { ops: LocalGitOps; calls: string[] } {
  const calls: string[] = [];
  const ops: LocalGitOps = {
    init: (d) => { calls.push(`init:${path.basename(d)}`); },
    checkoutNewBranch: (_d, b) => { calls.push(`branch:${b}`); },
    addAll: () => { calls.push("add"); },
    commit: () => { calls.push("commit"); },
    headSha: () => { calls.push("headSha"); return "deadbeefcafe0000"; },
    rootPatch: () => { calls.push("rootPatch"); return "--- a/agent.yaml\n+++ b/agent.yaml\n"; },
  };
  return { ops, calls };
}

async function authorized(dir: string): Promise<string> {
  const ctx: ProposalContext = { request: "Create a tax agent", intent: "build_agent", panels: [], now: NOW, env: {} };
  const p = generateProposals(ctx)[0]!;
  await saveProposal(dir, p, NOW);
  await markSimulatedApproved(dir, { id: p.id }, NOW);
  await approveForExecution(dir, { id: p.id }, NOW);
  return p.id;
}

describe("18A — local scaffold build (PR mode, no push/network)", () => {
  let dir: string;
  // Fail loudly if any code under test attempts a network call.
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (() => { throw new Error("network call attempted in 18A"); }) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; });
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "scaffold-build-")); });
  // (each temp dir cleaned by the OS; explicit cleanup below where useful)

  it("builds a local branch + commit + PR bundle, pushes nothing, no provider mutation", async () => {
    const id = await authorized(dir);
    const { ops, calls } = recordingGit();
    const r = await runLocalScaffoldBuild({ cwd: dir, ref: { id }, now: NOW, env: OPEN, scaffold: fakeScaffold(), git: ops });

    assert.equal(r.pushed, false);
    assert.equal(r.providerMutations, 0);
    assert.equal(r.executed, false);
    assert.equal(r.secretsClean, true);
    assert.match(r.branch, /^agent-scaffold\/tax-agent-[a-z0-9]+$/);
    assert.ok(r.files.includes("agent.yaml"));

    // Git was driven locally, in order, and there is no push call (the interface has none).
    assert.deepEqual(calls.filter((c) => c.startsWith("init") || c === "add" || c === "commit"), ["init:" + r.specId, "add", "commit"]);
    assert.ok(calls.some((c) => c === `branch:${r.branch}`));
    assert.ok(!calls.some((c) => c.includes("push")));

    // PR bundle exists; spec draft + manifest written.
    assert.ok(existsSync(r.prBodyPath) && existsSync(r.patchPath));
    const manifest = JSON.parse(await readFile(path.join(r.prDir, "build-manifest.json"), "utf8"));
    assert.equal(manifest.pushed, false);
    assert.equal(manifest.providerMutations, 0);

    await rm(dir, { recursive: true, force: true });
  });

  it("records an audit event without advancing the proposal (stays approved_for_execution)", async () => {
    const id = await authorized(dir);
    await runLocalScaffoldBuild({ cwd: dir, ref: { id }, now: NOW, env: OPEN, scaffold: fakeScaffold(), git: recordingGit().ops });
    const item = await readProposal(dir, id);
    assert.equal(item!.status, "approved_for_execution");
    assert.ok(item!.auditEvents.some((e) => e.event === "local_scaffold_built"));
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses unless the local gate is open (Key 2)", async () => {
    const id = await authorized(dir);
    await assert.rejects(
      () => runLocalScaffoldBuild({ cwd: dir, ref: { id }, now: NOW, env: {}, scaffold: fakeScaffold(), git: recordingGit().ops }),
      ScaffoldBuildPreconditionError
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses unless the proposal is approved_for_execution (Key 1)", async () => {
    const ctx: ProposalContext = { request: "Create a tax agent", intent: "build_agent", panels: [], now: NOW, env: {} };
    const p = generateProposals(ctx)[0]!;
    await saveProposal(dir, p, NOW);
    await markSimulatedApproved(dir, { id: p.id }, NOW); // authorized NOT called
    await assert.rejects(
      () => runLocalScaffoldBuild({ cwd: dir, ref: { id: p.id }, now: NOW, env: OPEN, scaffold: fakeScaffold(), git: recordingGit().ops }),
      ScaffoldBuildPreconditionError
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("fails closed on a generated secret, a forbidden file, or a workdir escape", async () => {
    // Secret content in a generated file.
    {
      const id = await authorized(dir);
      // Assemble a secret-shaped string at runtime so no literal token sits in source.
      const fakeSecret = "sk-" + "deadbeef".repeat(3);
      const leaky = fakeScaffold(async (outDir) => {
        await writeFile(path.join(outDir, "leak.txt"), `token ${fakeSecret}`, "utf8");
        return ["leak.txt"];
      });
      await assert.rejects(
        () => runLocalScaffoldBuild({ cwd: dir, ref: { id }, now: NOW, env: OPEN, scaffold: leaky, git: recordingGit().ops }),
        ScaffoldBuildPreconditionError
      );
    }
    // Forbidden real-secret filename.
    {
      const id = await authorized(dir);
      const forbidden: ScaffoldFn = async ({ outDir }) => {
        await writeFile(path.join(outDir, ".env"), "X=1\n", "utf8");
        return { files: [".env"] };
      };
      await assert.rejects(
        () => runLocalScaffoldBuild({ cwd: dir, ref: { id }, now: NOW, env: OPEN, scaffold: forbidden, git: recordingGit().ops }),
        ScaffoldBuildPreconditionError
      );
    }
    // File escaping the workdir.
    {
      const id = await authorized(dir);
      const escaper: ScaffoldFn = async () => ({ files: ["../escape.ts"] });
      await assert.rejects(
        () => runLocalScaffoldBuild({ cwd: dir, ref: { id }, now: NOW, env: OPEN, scaffold: escaper, git: recordingGit().ops }),
        ScaffoldBuildPreconditionError
      );
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("allows a nested, secret-free test fixture named .env (only ROOT real-secret files are forbidden)", async () => {
    const id = await authorized(dir);
    const withFixture = fakeScaffold(async (outDir) => {
      await mkdir(path.join(outDir, "tests", "fixtures", "risky-repo"), { recursive: true });
      await writeFile(path.join(outDir, "tests", "fixtures", "risky-repo", ".env"), "EXAMPLE_VAR=placeholder\n", "utf8");
      return ["tests/fixtures/risky-repo/.env"];
    });
    const r = await runLocalScaffoldBuild({ cwd: dir, ref: { id }, now: NOW, env: OPEN, scaffold: withFixture, git: recordingGit().ops });
    assert.ok(r.files.includes("tests/fixtures/risky-repo/.env"), "nested fixture .env is allowed");
    assert.equal(r.secretsClean, true);
    await rm(dir, { recursive: true, force: true });
  });

  it("rolls back with a clean local delete (nothing remote exists)", async () => {
    const id = await authorized(dir);
    const r = await runLocalScaffoldBuild({ cwd: dir, ref: { id }, now: NOW, env: OPEN, scaffold: fakeScaffold(), git: recordingGit().ops });
    assert.ok(existsSync(r.workDir) && existsSync(r.prDir));
    const removed = await rollbackLocalScaffold({ cwd: dir, specId: r.specId });
    assert.equal(removed.length, 2);
    assert.ok(!existsSync(r.workDir) && !existsSync(r.prDir));
    await rm(dir, { recursive: true, force: true });
  });
});
