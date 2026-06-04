/**
 * tests/github-adapter.test.ts
 *
 * Tests for the Phase 7A real GitHub adapter.
 * All GitHub API calls are mocked via injected fetch.
 * All git operations are mocked via injected GitLocalOps.
 * No real GitHub API calls or real git operations are performed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GitHubAdapter } from "../src/provisioning/adapters/github.js";
import { createMockGitOps } from "../src/provisioning/git-local.js";
import type { ProvisionContext, ProvisionStep } from "../src/provisioning/types.js";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeFetch(
  responses: Array<{ urlPart: string; status: number; body: unknown }>
): typeof fetch {
  return async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const match = responses.find((r) => url.includes(r.urlPart));
    const status = match?.status ?? 404;
    const body = match?.body ?? { message: "Not Found" };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function makeCtx(
  env: Record<string, string> = {},
  environment: "local" | "staging" | "production" = "staging"
): ProvisionContext {
  return { agentName: "test-agent", environment, env };
}

const baseEnv = {
  GITHUB_TOKEN: "test-token",
  GITHUB_OWNER: "test-owner",
  GITHUB_REPO_NAME: "test-repo",
  ALLOW_GITHUB_PROVISION: "true",
  ALLOW_GITHUB_PUSH: "true",
  ALLOW_AUTO_PROVISION: "true",
  CONFIRM_STAGING_PROVISION: "true",
};

const createRepoStep: ProvisionStep = {
  id: "github:create_repo:staging",
  provider: "github",
  action: "create_repo",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_GITHUB_PROVISION",
  description: "Create GitHub repo",
  safeSummary: "Creates GitHub repo",
  status: "planned",
};

const setRemoteStep: ProvisionStep = {
  id: "github:set_remote:staging",
  provider: "github",
  action: "set_remote",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_GITHUB_PROVISION",
  description: "Set git remote",
  safeSummary: "Sets git remote origin",
  status: "planned",
};

const pushStep: ProvisionStep = {
  id: "github:initial_push:staging",
  provider: "github",
  action: "initial_push",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_GITHUB_PUSH",
  description: "Initial push",
  safeSummary: "Initial commit and push",
  status: "planned",
};

// ─── Missing env ─────────────────────────────────────────────────────────────

describe("GitHub adapter — missing env", () => {
  test("missing GITHUB_TOKEN → verify shows missing_env", async () => {
    const adapter = new GitHubAdapter();
    const ctx = makeCtx({ GITHUB_OWNER: "owner", GITHUB_REPO_NAME: "repo" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("GITHUB_TOKEN"));
  });

  test("missing GITHUB_OWNER → verify shows missing_env", async () => {
    const adapter = new GitHubAdapter();
    const ctx = makeCtx({ GITHUB_TOKEN: "token", GITHUB_REPO_NAME: "repo" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("GITHUB_OWNER"));
  });

  test("missing GITHUB_REPO_NAME → verify shows missing_env", async () => {
    const adapter = new GitHubAdapter();
    const ctx = makeCtx({ GITHUB_TOKEN: "token", GITHUB_OWNER: "owner" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("GITHUB_REPO_NAME"));
  });

  test("missing env on create_repo apply → failed", async () => {
    const adapter = new GitHubAdapter(makeFetch([]));
    const ctx = makeCtx({ GITHUB_TOKEN: "token" }); // missing owner + repo
    const r = await adapter.apply(createRepoStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(r.message.includes("GITHUB_OWNER") || r.message.includes("missing"));
  });
});

// ─── Repo already exists ──────────────────────────────────────────────────────

describe("GitHub adapter — repo already exists", () => {
  test("existing repo returns already_exists (idempotent)", async () => {
    const fetch = makeFetch([
      { urlPart: "/repos/test-owner/test-repo", status: 200, body: { id: 1 } },
    ]);
    const adapter = new GitHubAdapter(fetch);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(createRepoStep, ctx);
    assert.equal(r.status, "already_exists");
    assert.ok(r.message.includes("already exists") || r.message.includes("already_exists"));
  });
});

// ─── Create repo via /user/repos ─────────────────────────────────────────────

describe("GitHub adapter — create repo", () => {
  test("creates repo via /user/repos endpoint", async () => {
    const fetch = makeFetch([
      // Check: repo doesn't exist
      { urlPart: "/repos/test-owner/test-repo", status: 404, body: { message: "Not Found" } },
      // Create via user/repos
      {
        urlPart: "/user/repos",
        status: 201,
        body: { id: 123, clone_url: "https://github.com/test-owner/test-repo.git" },
      },
    ]);
    const adapter = new GitHubAdapter(fetch);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(createRepoStep, ctx);
    assert.equal(r.status, "created");
    assert.ok(r.message.includes("test-owner/test-repo"));
  });

  test("falls back to /orgs/{owner}/repos when /user/repos returns 403", async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      callCount++;
      if (url.includes("/repos/test-owner/test-repo") && callCount === 1) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.includes("/user/repos")) {
        return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 });
      }
      if (url.includes("/orgs/test-owner/repos")) {
        return new Response(
          JSON.stringify({ id: 123, clone_url: "https://github.com/test-owner/test-repo.git" }),
          { status: 201 }
        );
      }
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    };
    const adapter = new GitHubAdapter(mockFetch);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(createRepoStep, ctx);
    assert.equal(r.status, "created");
  });

  test("permission failure returns failed with safe message (no token)", async () => {
    const fetch = makeFetch([
      { urlPart: "/repos/test-owner/test-repo", status: 404, body: { message: "Not Found" } },
      { urlPart: "/user/repos", status: 401, body: { message: "Unauthorized" } },
    ]);
    const adapter = new GitHubAdapter(fetch);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(createRepoStep, ctx);
    assert.equal(r.status, "failed");
    // Message must NOT contain token
    assert.ok(!r.message.includes("test-token"), "Message must not contain GITHUB_TOKEN");
    assert.ok(!r.message.includes("Bearer"), "Message must not contain Authorization header");
  });
});

// ─── set_remote ───────────────────────────────────────────────────────────────

describe("GitHub adapter — set_remote", () => {
  test("sets remote origin when no origin exists", async () => {
    const gitOps = createMockGitOps({ hasGitRepo: () => true, getRemoteOrigin: () => null });
    const adapter = new GitHubAdapter(makeFetch([]), gitOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(setRemoteStep, ctx);
    assert.equal(r.status, "applied");
    assert.ok(r.message.includes("test-owner/test-repo"));
  });

  test("returns already_exists when correct origin already set", async () => {
    const existingUrl = "https://github.com/test-owner/test-repo.git";
    const gitOps = createMockGitOps({
      hasGitRepo: () => true,
      getRemoteOrigin: () => existingUrl,
    });
    const adapter = new GitHubAdapter(makeFetch([]), gitOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(setRemoteStep, ctx);
    assert.equal(r.status, "already_exists");
  });

  test("fails if origin exists with different URL (no silent overwrite)", async () => {
    const gitOps = createMockGitOps({
      hasGitRepo: () => true,
      getRemoteOrigin: () => "https://github.com/other-owner/other-repo.git",
    });
    const adapter = new GitHubAdapter(makeFetch([]), gitOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(setRemoteStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(
      r.message.toLowerCase().includes("different") || r.message.toLowerCase().includes("remove"),
      "Should explain how to resolve the conflict"
    );
  });

  test("fails if no git repo initialized", async () => {
    const gitOps = createMockGitOps({ hasGitRepo: () => false });
    const adapter = new GitHubAdapter(makeFetch([]), gitOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(setRemoteStep, ctx);
    assert.equal(r.status, "failed");
  });
});

// ─── initial_push ────────────────────────────────────────────────────────────

describe("GitHub adapter — initial_push", () => {
  test("skips push when ALLOW_GITHUB_PUSH not set", async () => {
    const env = { ...baseEnv, ALLOW_GITHUB_PUSH: "false" };
    const gitOps = createMockGitOps({ hasGitRepo: () => true });
    const adapter = new GitHubAdapter(makeFetch([]), gitOps);
    const ctx = makeCtx(env);
    const r = await adapter.apply(pushStep, ctx);
    assert.equal(r.status, "skipped");
    assert.ok(
      r.message.includes("ALLOW_GITHUB_PUSH"),
      "Should tell user to set ALLOW_GITHUB_PUSH"
    );
  });

  test("pushes when ALLOW_GITHUB_PUSH=true", async () => {
    let pushed = false;
    const gitOps = createMockGitOps({
      hasGitRepo: () => true,
      getRemoteOrigin: () => "https://github.com/test-owner/test-repo.git",
      hasCommits: () => false,
      addAll: () => {},
      commit: () => {},
      push: () => { pushed = true; },
    });
    const adapter = new GitHubAdapter(makeFetch([]), gitOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(pushStep, ctx);
    assert.equal(r.status, "applied");
    assert.ok(pushed, "git push should have been called");
  });

  test("fails if no remote set", async () => {
    const gitOps = createMockGitOps({
      hasGitRepo: () => true,
      getRemoteOrigin: () => null,
    });
    const adapter = new GitHubAdapter(makeFetch([]), gitOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(pushStep, ctx);
    assert.equal(r.status, "failed");
  });
});

// ─── Token never in output ────────────────────────────────────────────────────

describe("GitHub adapter — token never in output", () => {
  test("verify() safeSummary never includes token value", async () => {
    const adapter = new GitHubAdapter();
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.ok(!vr.safeSummary.includes("test-token"), "safeSummary must not contain token");
    assert.ok(!vr.nextAction.includes("test-token"), "nextAction must not contain token");
  });

  test("apply create_repo message never includes token", async () => {
    const fetch = makeFetch([
      { urlPart: "/repos/test-owner/test-repo", status: 404, body: {} },
      { urlPart: "/user/repos", status: 201, body: { clone_url: "https://github.com/t/r.git" } },
    ]);
    const adapter = new GitHubAdapter(fetch);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(createRepoStep, ctx);
    assert.ok(!r.message.includes("test-token"), "result message must not contain token");
  });

  test("failed apply message never includes Authorization header", async () => {
    const fetch = makeFetch([
      { urlPart: "/repos/test-owner/test-repo", status: 404, body: {} },
      { urlPart: "/user/repos", status: 403, body: { message: "Forbidden" } },
    ]);
    const adapter = new GitHubAdapter(fetch);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(createRepoStep, ctx);
    assert.ok(!r.message.includes("Bearer"), "result message must not contain Bearer token");
    assert.ok(!r.message.includes("test-token"), "result message must not contain token value");
  });
});

// ─── Production gate ──────────────────────────────────────────────────────────

describe("GitHub adapter — production gate", () => {
  test("production create_repo step has productionGateRequired=true", async () => {
    const adapter = new GitHubAdapter();
    const ctx = makeCtx(baseEnv, "production");
    const steps = await adapter.plan(ctx);
    const createStep = steps.find((s) => s.action === "create_repo");
    assert.ok(createStep?.productionGateRequired === true);
  });
});

// ─── plan() ───────────────────────────────────────────────────────────────────

describe("GitHub adapter — plan()", () => {
  test("plan returns create_repo, set_remote, initial_push steps", async () => {
    const adapter = new GitHubAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const actions = steps.map((s) => s.action);
    assert.ok(actions.includes("create_repo"));
    assert.ok(actions.includes("set_remote"));
    assert.ok(actions.includes("initial_push"));
  });

  test("all mutating steps have requiredGate", async () => {
    const adapter = new GitHubAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    for (const step of steps.filter((s) => s.mutation)) {
      assert.ok(step.requiredGate, `Step ${step.action} must have requiredGate`);
    }
  });

  test("initial_push requires ALLOW_GITHUB_PUSH gate", async () => {
    const adapter = new GitHubAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const pushStep = steps.find((s) => s.action === "initial_push");
    assert.equal(pushStep?.requiredGate, "ALLOW_GITHUB_PUSH");
  });
});
