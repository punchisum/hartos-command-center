/**
 * src/provisioning/adapters/github.ts
 *
 * GitHub provider adapter — Phase 7A real implementation.
 *
 * plan():    Returns create_repo, set_remote, initial_push steps.
 * verify():  Checks GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO_NAME (env only).
 * apply():   Creates repo, sets git remote, optionally pushes.
 * rollback(): Returns manual rollback instructions (no auto-delete in Phase 7A).
 *
 * Security rules:
 *   - GITHUB_TOKEN is NEVER printed, logged, or included in messages.
 *   - Authorization headers are NEVER logged.
 *   - All messages use safe summaries (provider name, repo name, status codes only).
 *   - API errors are sanitized to status code + generic message.
 *   - Never commits .env or secrets.
 */

import type {
  ProviderAdapter,
  ProvisionStep,
  ProvisionStepResult,
  ProvisionContext,
  ProviderVerificationResult,
  RollbackStep,
} from "../types.js";
import { type GitLocalOps, realGitOps } from "../git-local.js";

const REQUIRED_ENV = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO_NAME"];
const GITHUB_API = "https://api.github.com";

/** Sanitize a message to remove potential secrets (40+ char sequences). */
function safe(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .slice(0, 200);
}

function result(
  step: ProvisionStep,
  status: ProvisionStepResult["status"],
  message: string
): ProvisionStepResult {
  return {
    step: { ...step, status },
    status,
    message: safe(message),
    timestamp: new Date().toISOString(),
  };
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

function makeHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

interface RepoCheckResult {
  exists: boolean;
  isOwner: boolean;
  httpStatus: number;
  error?: string;
}

async function checkRepoExists(
  token: string,
  owner: string,
  repo: string,
  fetchImpl: typeof fetch
): Promise<RepoCheckResult> {
  try {
    const res = await fetchImpl(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: "GET",
      headers: makeHeaders(token),
    });
    if (res.status === 200) {
      return { exists: true, isOwner: true, httpStatus: 200 };
    }
    if (res.status === 404) {
      return { exists: false, isOwner: false, httpStatus: 404 };
    }
    return {
      exists: false,
      isOwner: false,
      httpStatus: res.status,
      error: `Unexpected status: ${res.status}`,
    };
  } catch (err) {
    return {
      exists: false,
      isOwner: false,
      httpStatus: 0,
      error: `Network error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
    };
  }
}

interface CreateRepoResult {
  created: boolean;
  repoUrl?: string;
  httpStatus: number;
  error?: string;
}

async function createRepo(
  token: string,
  owner: string,
  repo: string,
  opts: { private: boolean; description?: string; homepage?: string },
  fetchImpl: typeof fetch
): Promise<CreateRepoResult> {
  const body = {
    name: repo,
    private: opts.private,
    auto_init: false,
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.homepage ? { homepage: opts.homepage } : {}),
  };

  // Try user/repos first; fall back to orgs/{owner}/repos for orgs
  const endpoints = [
    `${GITHUB_API}/user/repos`,
    `${GITHUB_API}/orgs/${owner}/repos`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify(body),
      });

      if (res.status === 201) {
        const data = (await res.json()) as { html_url?: string; clone_url?: string };
        return {
          created: true,
          repoUrl: data.clone_url,
          httpStatus: 201,
        };
      }

      // 403 on user/repos might mean it's an org — try next endpoint
      if (res.status === 403 && endpoint.includes("/user/repos")) {
        continue;
      }

      // 422 = validation error (e.g. repo already exists via race condition)
      if (res.status === 422) {
        return { created: false, httpStatus: 422, error: "Repo name already taken or invalid" };
      }

      return {
        created: false,
        httpStatus: res.status,
        error: `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        created: false,
        httpStatus: 0,
        error: `Network error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
      };
    }
  }

  return { created: false, httpStatus: 0, error: "All creation endpoints failed" };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class GitHubAdapter implements ProviderAdapter {
  readonly provider = "github" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly gitOps: GitLocalOps;

  constructor(
    fetchImpl: typeof fetch = fetch,
    gitOps: GitLocalOps = realGitOps
  ) {
    this.fetchImpl = fetchImpl;
    this.gitOps = gitOps;
  }

  async plan(context: ProvisionContext): Promise<ProvisionStep[]> {
    const isProd = context.environment === "production";
    const base = `${context.agentName}/${context.environment}`;

    return [
      {
        id: `github:create_repo:${context.environment}`,
        provider: "github",
        action: "create_repo",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_GITHUB_PROVISION",
        productionGateRequired: isProd,
        description: `Create GitHub repository for ${context.agentName}`,
        safeSummary:
          "Creates private GitHub repo. " +
          "Idempotent: returns already_exists if repo exists.",
        rollback: {
          description:
            "Archive or delete repo via GitHub dashboard. " +
            "No automatic deletion in Phase 7A.",
          notes:
            "Deleting is irreversible. Confirm before acting.",
        },
        status: "planned",
      },
      {
        id: `github:set_remote:${context.environment}`,
        provider: "github",
        action: "set_remote",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_GITHUB_PROVISION",
        productionGateRequired: isProd,
        description: `Set git remote origin for ${context.agentName}`,
        safeSummary:
          "Sets git remote origin to https://github.com/{owner}/{repo}.git. " +
          "Skips if origin already set.",
        rollback: {
          description: "Remove remote: git remote remove origin",
          command: "git remote remove origin",
        },
        status: "planned",
      },
      {
        id: `github:initial_push:${context.environment}`,
        provider: "github",
        action: "initial_push",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_GITHUB_PUSH",
        productionGateRequired: isProd,
        description: `Initial commit and push for ${context.agentName}`,
        safeSummary:
          "Makes initial commit and pushes to GitHub. " +
          "Requires ALLOW_GITHUB_PUSH=true. " +
          "Respects .gitignore — never commits .env or secrets.",
        rollback: {
          description: "Revert the push: git revert HEAD or delete the branch.",
          notes: "Force-push is not used in Phase 7A.",
        },
        status: "planned",
      },
    ];
  }

  async verify(context: ProvisionContext): Promise<ProviderVerificationResult> {
    const missingEnv = REQUIRED_ENV.filter((k) => !context.env[k]);

    // Note: We never call GitHub API in verify() — it's env-only.
    // The actual API call happens in apply().
    if (missingEnv.length > 0) {
      return {
        provider: "github",
        status: "missing_env",
        missingEnv,
        supportedActions: ["create_repo", "set_remote", "initial_push"],
        unsupportedActions: [],
        nextAction: `Set ${missingEnv.join(", ")} to configure GitHub`,
        safeSummary: `GitHub not configured — missing: ${missingEnv.join(", ")}`,
      };
    }

    const owner = context.env["GITHUB_OWNER"] ?? context.env["GITHUB_ORG"] ?? "";
    const repo = context.env["GITHUB_REPO_NAME"] ?? "";

    return {
      provider: "github",
      status: "configured",
      missingEnv: [],
      supportedActions: ["create_repo", "set_remote", "initial_push"],
      unsupportedActions: [],
      nextAction: `Run provision:auto to create repo ${owner}/${repo}`,
      safeSummary: `GitHub configured. Owner: ${owner || "set"}, Repo: ${repo || "set"}`,
    };
  }

  async apply(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    switch (step.action) {
      case "create_repo":
        return this.applyCreateRepo(step, context);
      case "set_remote":
        return this.applySetRemote(step, context);
      case "initial_push":
        return this.applyInitialPush(step, context);
      default:
        return result(
          step,
          "not_implemented",
          `GitHub action ${step.action} not implemented in Phase 7A`
        );
    }
  }

  async rollback(
    step: RollbackStep,
    _context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    // Phase 7A: no automatic deletion. Return instructions only.
    return {
      step: {
        id: "github:rollback",
        provider: "github",
        action: "create_repo",
        environment: "local",
        mutation: false,
        description: step.description,
        safeSummary: "Manual rollback required",
        status: "skipped",
      },
      status: "skipped",
      message: `Rollback instruction: ${step.description} (manual — no auto-delete in Phase 7A)`,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Private apply methods ────────────────────────────────────────────────

  private async applyCreateRepo(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const token = context.env["GITHUB_TOKEN"];
    const owner =
      context.env["GITHUB_OWNER"] ?? context.env["GITHUB_ORG"];
    const repo = context.env["GITHUB_REPO_NAME"];

    if (!token || !owner || !repo) {
      const missing: string[] = [];
      if (!token) missing.push("GITHUB_TOKEN");
      if (!owner) missing.push("GITHUB_OWNER");
      if (!repo) missing.push("GITHUB_REPO_NAME");
      return result(step, "failed", `Missing env: ${missing.join(", ")}`);
    }

    // Check if repo already exists (idempotent)
    const check = await checkRepoExists(token, owner, repo, this.fetchImpl);
    if (check.exists) {
      return result(
        step,
        "already_exists",
        `Repo ${owner}/${repo} already exists`
      );
    }
    if (check.error && check.httpStatus !== 404) {
      return result(
        step,
        "failed",
        `Check failed HTTP ${check.httpStatus}: ${check.error}`
      );
    }

    // Create the repo
    const isPrivate = (context.env["GITHUB_PRIVATE_REPO"] ?? "true") !== "false";
    const created = await createRepo(
      token,
      owner,
      repo,
      {
        private: isPrivate,
        description: context.env["GITHUB_DESCRIPTION"],
        homepage: context.env["GITHUB_HOMEPAGE"],
      },
      this.fetchImpl
    );

    if (created.created) {
      return result(
        step,
        "created",
        `Repo ${owner}/${repo} created (${isPrivate ? "private" : "public"})`
      );
    }

    return result(
      step,
      "failed",
      `Create failed HTTP ${created.httpStatus}: ${created.error ?? "unknown"}`
    );
  }

  private async applySetRemote(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const owner =
      context.env["GITHUB_OWNER"] ?? context.env["GITHUB_ORG"];
    const repo = context.env["GITHUB_REPO_NAME"];

    if (!owner || !repo) {
      return result(step, "failed", "Missing GITHUB_OWNER or GITHUB_REPO_NAME");
    }

    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    const cwd = process.cwd();

    // Initialize git repo if needed (safe: only if no .git)
    if (!this.gitOps.hasGitRepo(cwd)) {
      return result(
        step,
        "failed",
        "No git repo found. Initialize git first."
      );
    }

    const existingOrigin = this.gitOps.getRemoteOrigin(cwd);
    if (existingOrigin !== null) {
      if (existingOrigin === repoUrl) {
        return result(step, "already_exists", `Remote origin already set: ${owner}/${repo}`);
      }
      // Different origin — do not overwrite silently
      return result(
        step,
        "failed",
        `Remote origin exists with different URL. Remove it manually: git remote remove origin`
      );
    }

    try {
      this.gitOps.setRemoteOrigin(cwd, repoUrl);
      return result(step, "applied", `Remote origin set: ${owner}/${repo}`);
    } catch (err) {
      return result(
        step,
        "failed",
        `Failed to set remote: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`
      );
    }
  }

  private async applyInitialPush(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    // Secondary check: ALLOW_GITHUB_PUSH (already enforced as gate, but verify)
    if (context.env["ALLOW_GITHUB_PUSH"] !== "true") {
      return result(
        step,
        "skipped",
        "Push skipped: set ALLOW_GITHUB_PUSH=true to push"
      );
    }

    const branch =
      context.env["GITHUB_DEFAULT_BRANCH"] ?? "main";
    const cwd = process.cwd();

    if (!this.gitOps.hasGitRepo(cwd)) {
      return result(step, "failed", "No git repo found. Run git init first.");
    }

    const origin = this.gitOps.getRemoteOrigin(cwd);
    if (!origin) {
      return result(step, "failed", "No remote origin set. Run set_remote first.");
    }

    try {
      // Only make initial commit if no commits yet
      if (!this.gitOps.hasCommits(cwd)) {
        this.gitOps.addAll(cwd);
        this.gitOps.commit(cwd, "Initial commit from HartOS Agent Factory v2");
      }
      this.gitOps.push(cwd, branch);
      return result(step, "applied", `Pushed to origin/${branch}`);
    } catch (err) {
      return result(
        step,
        "failed",
        `Push failed: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`
      );
    }
  }
}
