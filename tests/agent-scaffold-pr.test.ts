/**
 * tests/agent-scaffold-pr.test.ts
 *
 * Phase 18B — controlled GitHub PR mode. Hermetic: GitHubPrOps is mocked, a throwing fetch is
 * installed, and the 18A build is produced with injected fakes — so there is ZERO network and no
 * real git/GitHub. Proves: gated dry-run by default; fail-closed on missing token / missing confirm
 * gate; mocked push+PR when fully gated; PR body has the scaffold summary + safety boundaries and no
 * secrets; rollback (manual default + gated auto); executeProposal still throws; the Worker cannot
 * import this path; and no provider (Supabase/Cloudflare/Telegram/Trigger) module is referenced.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveProposal,
  markSimulatedApproved,
  approveForExecution,
  generateProposals,
  executeProposal,
  ActionExecutionDisabledError,
  readProposal,
  type ProposalContext,
} from "../src/cockpit/proposals/index.js";
import {
  runLocalScaffoldBuild,
  runGithubPrMode,
  runGithubPrRollback,
  GithubPrPreconditionError,
  LOCAL_SCAFFOLD_GATE,
  type ScaffoldFn,
  type LocalGitOps,
  type GitHubPrOps,
} from "../src/execution/index.js";

const NOW = "2026-06-05T12:00:00.000Z";
const FULL_GATES = {
  ALLOW_GITHUB_PUSH: "true",
  CONFIRM_GITHUB_PR: "true",
  HARTOS_GITHUB_TOKEN: "ghtokenplaceholder",
  HARTOS_GITHUB_OWNER: "punchisum",
  HARTOS_GITHUB_REPO: "tax-agent",
};

function fakeScaffold(): ScaffoldFn {
  return async ({ outDir }) => {
    await mkdir(path.join(outDir, "src"), { recursive: true });
    await writeFile(path.join(outDir, "agent.yaml"), "name: tax-agent\n", "utf8");
    await writeFile(path.join(outDir, "src", "index.ts"), "export const x = 1;\n", "utf8");
    return { files: ["agent.yaml", "src/index.ts"] };
  };
}

function noopGit(): LocalGitOps {
  return {
    init: () => {}, checkoutNewBranch: () => {}, addAll: () => {}, commit: () => {},
    headSha: () => "deadbeefcafe0000", rootPatch: () => "--- a\n+++ b\n",
  };
}

/** Recording mock GitHub ops — no network. */
function mockPrOps(overrides: Partial<GitHubPrOps> = {}): { ops: GitHubPrOps; calls: string[]; bodies: string[] } {
  const calls: string[] = [];
  const bodies: string[] = [];
  const ops: GitHubPrOps = {
    pushScaffoldOntoBase: async ({ branch, base }) => { calls.push(`push:${branch}<-${base}`); },
    openPullRequest: async ({ body }) => { calls.push("openPr"); bodies.push(body); return { url: "https://github.com/punchisum/tax-agent/pull/7", number: 7 }; },
    closePullRequest: async ({ number }) => { calls.push(`closePr:${number}`); },
    deleteRemoteBranch: async ({ branch }) => { calls.push(`deleteBranch:${branch}`); },
    ...overrides,
  };
  return { ops, calls, bodies };
}

/** Produce an authorized + built (18A) scaffold; returns the proposal id. */
async function built(dir: string): Promise<string> {
  const ctx: ProposalContext = { request: "Create a tax agent", intent: "build_agent", panels: [], now: NOW, env: {} };
  const p = generateProposals(ctx)[0]!;
  await saveProposal(dir, p, NOW);
  await markSimulatedApproved(dir, { id: p.id }, NOW);
  await approveForExecution(dir, { id: p.id }, NOW);
  await runLocalScaffoldBuild({ cwd: dir, ref: { id: p.id }, now: NOW, env: { [LOCAL_SCAFFOLD_GATE]: "true" }, scaffold: fakeScaffold(), git: noopGit() });
  return p.id;
}

describe("18B — controlled GitHub PR mode (no network)", () => {
  let dir: string;
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (() => { throw new Error("network call attempted in 18B test"); }) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; });
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "scaffold-pr-")); });

  it("with no gates: dry-run only, nothing pushed", async () => {
    const id = await built(dir);
    const { ops, calls } = mockPrOps();
    const r = await runGithubPrMode({ cwd: dir, ref: { id }, now: NOW, env: {}, prOps: ops });
    assert.equal(r.mode, "dry_run");
    assert.equal(r.pushed, false);
    assert.equal(r.prUrl, null);
    assert.deepEqual(calls, []);
    assert.ok(r.instructions.length > 0);
    const item = await readProposal(dir, id);
    assert.ok(item!.auditEvents.some((e) => e.event === "github_pr_dryrun"));
    await rm(dir, { recursive: true, force: true });
  });

  it("missing token: fail closed (dry-run, no push/PR)", async () => {
    const id = await built(dir);
    const { ops, calls } = mockPrOps();
    const env = { ...FULL_GATES, HARTOS_GITHUB_TOKEN: "" };
    const r = await runGithubPrMode({ cwd: dir, ref: { id }, now: NOW, env, prOps: ops });
    assert.equal(r.mode, "dry_run");
    assert.ok(r.instructions.some((l) => l.includes("HARTOS_GITHUB_TOKEN")));
    assert.deepEqual(calls, []);
    await rm(dir, { recursive: true, force: true });
  });

  it("push gate without confirm gate: fail closed", async () => {
    const id = await built(dir);
    const { ops, calls } = mockPrOps();
    const env = { ...FULL_GATES, CONFIRM_GITHUB_PR: "false" };
    const r = await runGithubPrMode({ cwd: dir, ref: { id }, now: NOW, env, prOps: ops });
    assert.equal(r.mode, "dry_run");
    assert.deepEqual(calls, []);
    await rm(dir, { recursive: true, force: true });
  });

  it("both gates open: mocked push + PR creation, URL captured, audited", async () => {
    const id = await built(dir);
    const { ops, calls } = mockPrOps();
    const r = await runGithubPrMode({ cwd: dir, ref: { id }, now: NOW, env: FULL_GATES, prOps: ops });
    assert.equal(r.mode, "opened");
    assert.equal(r.pushed, true);
    assert.equal(r.merged, false);
    assert.equal(r.providerMutations, 0);
    assert.equal(r.prUrl, "https://github.com/punchisum/tax-agent/pull/7");
    assert.equal(r.prNumber, 7);
    assert.ok(calls.some((c) => c.startsWith("push:") && c.includes("<-main")) && calls.includes("openPr"));
    const item = await readProposal(dir, id);
    assert.ok(item!.auditEvents.some((e) => e.event === "github_pr_opened"));
    assert.equal(item!.status, "approved_for_execution", "not advanced to executed/merged");
    await rm(dir, { recursive: true, force: true });
  });

  it("PR body has the scaffold summary + safety boundaries and no secrets", async () => {
    const id = await built(dir);
    const { ops, bodies } = mockPrOps();
    await runGithubPrMode({ cwd: dir, ref: { id }, now: NOW, env: FULL_GATES, prOps: ops });
    const body = bodies[0]!;
    assert.match(body, /tax-agent/);
    assert.match(body, /Safety boundaries/);
    assert.match(body, /No provider was created/i);
    // A token-shaped string must never reach the PR body.
    assert.match(body, /scaffold/i);
    assert.equal(/gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}/.test(body), false);
    await rm(dir, { recursive: true, force: true });
  });

  it("fails closed when no scaffold was built", async () => {
    const ctx: ProposalContext = { request: "Create a tax agent", intent: "build_agent", panels: [], now: NOW, env: {} };
    const p = generateProposals(ctx)[0]!;
    await saveProposal(dir, p, NOW);
    await markSimulatedApproved(dir, { id: p.id }, NOW);
    await approveForExecution(dir, { id: p.id }, NOW); // authorized but NOT built
    await assert.rejects(
      () => runGithubPrMode({ cwd: dir, ref: { id: p.id }, now: NOW, env: FULL_GATES, prOps: mockPrOps().ops }),
      GithubPrPreconditionError
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("rollback: manual instructions by default; gated auto-rollback closes PR + deletes branch", async () => {
    const id = await built(dir);
    const open = mockPrOps();
    await runGithubPrMode({ cwd: dir, ref: { id }, now: NOW, env: FULL_GATES, prOps: open.ops });

    // Default — no gate: instructions only, no remote calls.
    const m1 = mockPrOps();
    const manual = await runGithubPrRollback({ cwd: dir, ref: { id }, now: NOW, env: {}, prOps: m1.ops });
    assert.equal(manual.mode, "instructions");
    assert.deepEqual(m1.calls, []);
    assert.ok(manual.instructions.length > 0);

    // Gated — auto rollback: close PR (never merge) + delete remote branch.
    const m2 = mockPrOps();
    const auto = await runGithubPrRollback({
      cwd: dir, ref: { id }, now: NOW,
      env: { ALLOW_GITHUB_REMOTE_ROLLBACK: "true", HARTOS_GITHUB_TOKEN: "t", HARTOS_GITHUB_OWNER: "punchisum", HARTOS_GITHUB_REPO: "tax-agent" },
      prOps: m2.ops,
    });
    assert.equal(auto.mode, "rolled_back");
    assert.ok(m2.calls.some((c) => c.startsWith("closePr:")) && m2.calls.some((c) => c.startsWith("deleteBranch:")));
    const item = await readProposal(dir, id);
    assert.ok(item!.auditEvents.some((e) => e.event === "github_pr_rolled_back"));
    await rm(dir, { recursive: true, force: true });
  });

  it("executeProposal still throws", () => {
    assert.throws(() => executeProposal(), ActionExecutionDisabledError);
  });

  it("the hosted Worker does not import the execution path", async () => {
    const worker = await readFile(path.join(process.cwd(), "src/runtime/cloudflare-cockpit-worker.ts"), "utf8");
    assert.equal(/from\s+["'][^"']*execution[^"']*["']/.test(worker), false, "Worker must not import src/execution");
  });

  it("18B touches no provider (Supabase/Cloudflare/Telegram/Trigger) modules", async () => {
    for (const f of ["src/execution/run-github-pr.ts", "src/execution/github-pr.ts"]) {
      const src = await readFile(path.join(process.cwd(), f), "utf8");
      assert.equal(/adapters\/(supabase|cloudflare|telegram|trigger)|provisioning\/engine/.test(src), false, `${f} must not import provider/provisioning modules`);
    }
  });
});
