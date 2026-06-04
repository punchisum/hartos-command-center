/**
 * src/execution/run-github-pr.ts
 *
 * Phase 18B — controlled GitHub PR mode. The FIRST phase that mutates real external state, and only
 * GitHub (push a branch + open a PR against an EXISTING repo). Everything is gated; with any gate
 * closed it returns DRY-RUN instructions and touches nothing.
 *
 * Scope (enforced): push + open PR only. NO repo creation, NO merge, NO Supabase/Cloudflare/Telegram/
 * Trigger, NO provisioning, NO deploy. Node CLI only — never reachable from the hosted Worker.
 * executeProposal() still throws; the proposal is NOT advanced to executed/merged.
 */

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { containsSecret } from "../llm/redaction.js";
import { resolveRef, appendAudit, type ProposalRef } from "../cockpit/proposals/proposal-queue.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { DEFAULT_SCAFFOLD_DIR } from "./local-scaffold-build.js";
import { realGitHubPrOps, type GitHubPrOps } from "./github-pr.js";

export const PUSH_GATE = "ALLOW_GITHUB_PUSH";
export const PR_GATE = "CONFIRM_GITHUB_PR";
export const REMOTE_ROLLBACK_GATE = "ALLOW_GITHUB_REMOTE_ROLLBACK";
const TOKEN_KEY = "HARTOS_GITHUB_TOKEN";
const OWNER_KEY = "HARTOS_GITHUB_OWNER";
const REPO_KEY = "HARTOS_GITHUB_REPO";
const BASE_KEY = "HARTOS_GITHUB_BASE_BRANCH";

export class GithubPrPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubPrPreconditionError";
  }
}

interface BuildManifest {
  specId: string;
  proposalId: string;
  agentName: string;
  branch: string;
  commitSha: string;
  files: string[];
}

interface GateConfig {
  pushGate: boolean;
  prGate: boolean;
  token: string | null;
  owner: string | null;
  repo: string | null;
  baseBranch: string;
  /** Names of the gates/keys that are missing (empty = fully gated/ready). */
  missing: string[];
}

function readGates(env: Record<string, string | undefined>): GateConfig {
  const missing: string[] = [];
  const pushGate = env[PUSH_GATE] === "true";
  const prGate = env[PR_GATE] === "true";
  const token = env[TOKEN_KEY]?.trim() || null;
  const owner = env[OWNER_KEY]?.trim() || null;
  const repo = env[REPO_KEY]?.trim() || null;
  if (!pushGate) missing.push(`${PUSH_GATE}=true`);
  if (!prGate) missing.push(`${PR_GATE}=true`);
  if (!token) missing.push(TOKEN_KEY);
  if (!owner) missing.push(OWNER_KEY);
  if (!repo) missing.push(REPO_KEY);
  return { pushGate, prGate, token, owner, repo, baseBranch: env[BASE_KEY]?.trim() || "main", missing };
}

async function loadManifest(prDir: string): Promise<BuildManifest> {
  const file = path.join(prDir, "build-manifest.json");
  if (!existsSync(file)) {
    throw new GithubPrPreconditionError(
      "No built scaffold found. Run `agent:scaffold-build` (18A) first to produce the local branch + commit."
    );
  }
  return JSON.parse(await readFile(file, "utf8")) as BuildManifest;
}

function dryRunInstructions(g: GateConfig, m: BuildManifest, owner: string, repo: string): string[] {
  return [
    "GitHub PR mode is gated and currently DRY-RUN (nothing was pushed).",
    `Missing: ${g.missing.join(", ")}`,
    "To open the PR for real, on the Node host set (never commit these):",
    `  ${PUSH_GATE}=true ${PR_GATE}=true ${TOKEN_KEY}=<token> ${OWNER_KEY}=${owner} ${REPO_KEY}=${repo}`,
    `Then push branch \`${m.branch}\` to the EXISTING repo ${owner}/${repo} and open a PR against \`${g.baseBranch}\`.`,
    "The target repo must already exist — 18B never creates a repo.",
  ];
}

function rollbackInstructions(owner: string, repo: string, branch: string, prNumber: number | null): string[] {
  return [
    "Manual remote rollback (default — no automated remote mutation):",
    prNumber != null ? `  - Close PR #${prNumber}: ${owner}/${repo}` : "  - Close the PR in the GitHub UI",
    `  - Delete the remote branch:  git push https://github.com/${owner}/${repo}.git --delete ${branch}`,
    `Or enable automated rollback: set ${REMOTE_ROLLBACK_GATE}=true and run agent:scaffold-pr-rollback.`,
  ];
}

function buildPrBody(m: BuildManifest, p: Record<string, unknown>): string {
  const summary = typeof p["summary"] === "string" ? (p["summary"] as string) : "";
  return [
    `# Add \`${m.agentName}\` (scaffold)`,
    "",
    `Generated from approved proposal \`${m.proposalId}\` (spec \`${m.specId}\`), commit \`${m.commitSha.slice(0, 10)}\`, ${m.files.length} files.`,
    "",
    summary,
    "",
    "## Safety boundaries",
    "- Scaffold only. **No provider was created, deployed, or mutated** opening this PR.",
    "- No secrets are included; do not merge until reviewed.",
    "- Provider provisioning (Supabase/Cloudflare/Telegram/Trigger) is a separate, later, gated phase.",
    "",
  ].join("\n");
}

export interface GithubPrResult {
  mode: "dry_run" | "opened";
  specId: string;
  proposalId: string;
  agentName: string;
  branch: string;
  /** PR details when mode==="opened". */
  prUrl: string | null;
  prNumber: number | null;
  pushed: boolean;
  merged: false;
  providerMutations: 0;
  executed: false;
  instructions: string[];
}

export interface GithubPrOptions {
  cwd: string;
  ref: ProposalRef;
  now: string;
  env?: Record<string, string | undefined>;
  outRoot?: string;
  /** Injected in tests; defaults to the real REST/git impl (reached only when gated). */
  prOps?: GitHubPrOps;
}

function loadAuthorized(item: ProposalQueueItem | null): ProposalQueueItem {
  if (!item) throw new GithubPrPreconditionError("Proposal not found.");
  if (item.actionType !== "agent_creation_plan") {
    throw new GithubPrPreconditionError(`18B only supports agent_creation_plan, got "${item.actionType}".`);
  }
  // Key 1 — explicit authorization (a prompt cannot reach this path).
  if (item.status !== "approved_for_execution") {
    throw new GithubPrPreconditionError(
      `Proposal must be approved_for_execution (was "${item.status}"). Authorize it first (Key 1).`
    );
  }
  return item;
}

/**
 * Push the built scaffold branch + open a PR against an EXISTING repo — only when all gates are open;
 * otherwise return dry-run instructions and touch nothing.
 */
export async function runGithubPrMode(opts: GithubPrOptions): Promise<GithubPrResult> {
  const { cwd, ref, now } = opts;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const prOps = opts.prOps ?? realGitHubPrOps;
  const outRoot = opts.outRoot ?? DEFAULT_SCAFFOLD_DIR;

  const item = loadAuthorized(await resolveRef(cwd, ref));
  const specId = item.specId!;
  const workDir = path.join(cwd, outRoot, specId);
  const prDir = path.join(cwd, outRoot, `${specId}.pr`);
  const manifest = await loadManifest(prDir);
  const g = readGates(env);

  const base = {
    specId,
    proposalId: item.id,
    agentName: manifest.agentName,
    branch: manifest.branch,
    merged: false as const,
    providerMutations: 0 as const,
    executed: false as const,
  };

  // Any gate closed → DRY-RUN. No push, no PR, no network.
  if (g.missing.length > 0) {
    const instructions = dryRunInstructions(g, manifest, g.owner ?? "<owner>", g.repo ?? "<repo>");
    await writeFile(path.join(prDir, "github-pr-report.json"), JSON.stringify({ mode: "dry_run", ...base, missing: g.missing, instructions }, null, 2) + "\n", "utf8");
    await appendAudit(cwd, { id: item.id }, "github_pr_dryrun", now, `missing: ${g.missing.join(", ")}`);
    return { mode: "dry_run", ...base, prUrl: null, prNumber: null, pushed: false, instructions };
  }

  const owner = g.owner!, repo = g.repo!, token = g.token!;
  const title = `Add ${manifest.agentName} (scaffold)`;
  const body = buildPrBody(manifest, (item.proposedPayload ?? {}) as Record<string, unknown>);
  if (containsSecret(body)) throw new GithubPrPreconditionError("PR body would contain a secret — aborting.");

  // Gated real mutation: push the existing branch, then open the PR.
  await prOps.pushBranch({ workDir, owner, repo, branch: manifest.branch, token });
  const pr = await prOps.openPullRequest({ owner, repo, token, head: manifest.branch, base: g.baseBranch, title, body });

  const instructions = rollbackInstructions(owner, repo, manifest.branch, pr.number);
  await writeFile(
    path.join(prDir, "github-pr-report.json"),
    JSON.stringify({ mode: "opened", ...base, prUrl: pr.url, prNumber: pr.number, pushed: true, baseBranch: g.baseBranch, rollback: instructions }, null, 2) + "\n",
    "utf8"
  );
  await appendAudit(cwd, { id: item.id }, "github_pr_opened", now, `PR ${pr.url} (branch ${manifest.branch} → ${g.baseBranch}); not merged`);

  return { mode: "opened", ...base, prUrl: pr.url, prNumber: pr.number, pushed: true, instructions };
}

export interface GithubPrRollbackResult {
  mode: "instructions" | "rolled_back";
  prNumber: number | null;
  branch: string;
  instructions: string[];
}

/**
 * Remote rollback. DEFAULT: print manual instructions (no remote mutation). Only when
 * ALLOW_GITHUB_REMOTE_ROLLBACK=true (+ token/owner/repo) does it close the PR + delete the branch.
 */
export async function runGithubPrRollback(opts: GithubPrOptions): Promise<GithubPrRollbackResult> {
  const { cwd, ref, now } = opts;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const prOps = opts.prOps ?? realGitHubPrOps;
  const outRoot = opts.outRoot ?? DEFAULT_SCAFFOLD_DIR;

  const item = loadAuthorized(await resolveRef(cwd, ref));
  const specId = item.specId!;
  const prDir = path.join(cwd, outRoot, `${specId}.pr`);
  const reportFile = path.join(prDir, "github-pr-report.json");
  if (!existsSync(reportFile)) {
    throw new GithubPrPreconditionError("No github-pr-report.json — open a PR (18B) before attempting rollback.");
  }
  const report = JSON.parse(await readFile(reportFile, "utf8")) as { branch: string; prNumber: number | null };
  const owner = env[OWNER_KEY]?.trim() || null;
  const repo = env[REPO_KEY]?.trim() || null;
  const token = env[TOKEN_KEY]?.trim() || null;
  const instructions = rollbackInstructions(owner ?? "<owner>", repo ?? "<repo>", report.branch, report.prNumber);

  // Default: manual instructions only — no remote mutation.
  if (env[REMOTE_ROLLBACK_GATE] !== "true" || !owner || !repo || !token) {
    await appendAudit(cwd, { id: item.id }, "github_pr_rollback_instructions", now, "manual rollback (auto-rollback gate closed)");
    return { mode: "instructions", prNumber: report.prNumber, branch: report.branch, instructions };
  }

  // Gated automated rollback: close the PR (no merge) + delete the remote branch.
  if (report.prNumber != null) await prOps.closePullRequest({ owner, repo, token, number: report.prNumber });
  await prOps.deleteRemoteBranch({ owner, repo, token, branch: report.branch });
  await appendAudit(cwd, { id: item.id }, "github_pr_rolled_back", now, `closed PR #${report.prNumber ?? "?"}, deleted ${report.branch}`);
  return { mode: "rolled_back", prNumber: report.prNumber, branch: report.branch, instructions };
}
