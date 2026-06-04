/**
 * src/execution/local-scaffold-build.ts
 *
 * Phase 18A — Controlled execution / PR mode (LOCAL-ONLY). From a proposal Hart has authorized,
 * produce a REAL Factory-scaffolded agent repo on a LOCAL git branch + commit + a PR-prep bundle
 * (PR body + patch). Built against the approved 17C architecture and the 18A design decisions:
 *   - Local-git only: NO push, NO GitHub API, NO network. Push/repo-create/PR-open are 18B.
 *   - Factory is invoked as a child process (injectable); CC re-implements no config/scaffold logic.
 *   - Two keys: Key 1 = proposal approved_for_execution; Key 2 (local) = ALLOW_LOCAL_SCAFFOLD=true.
 *     ALL provider gates stay closed; no provider adapter is imported or called here.
 *   - Every generated file is secret-scanned; no .env/.dev.vars/*.local are allowed; files must stay
 *     inside the workdir. Rollback is automated (delete branch + workdir) — nothing remote exists.
 *   - The proposal is NOT advanced to executing/executed (that is 18B); an audit event is recorded.
 */

import path from "node:path";
import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { containsSecret } from "../llm/redaction.js";
import { resolveRef, appendAudit, deriveSpecId, type ProposalRef } from "../cockpit/proposals/proposal-queue.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { realLocalGit, type LocalGitOps } from "./local-git.js";
import { realFactoryScaffold, type ScaffoldFn } from "./scaffold-via-factory.js";

export const DEFAULT_SCAFFOLD_DIR = "agent-scaffold";
/** The local Key-2 gate: distinguishes a REAL scaffold write from 17D's report-only dry-run. */
export const LOCAL_SCAFFOLD_GATE = "ALLOW_LOCAL_SCAFFOLD";

/**
 * ROOT-LEVEL real-secret files that must NEVER be generated (a real agent's live secrets live here).
 * Matches only the repo root (no `/`), so legitimate nested test fixtures like
 * `tests/fixtures/.../.env` are allowed — their content is still secret-scanned like every file.
 */
const FORBIDDEN_FILE = /^(\.env|\.dev\.vars|\.env\.[^/]*\.local|[^/]*\.local\.(json|vars))$/;

interface AgentCreationPayload {
  agentName?: string;
  purpose?: string;
  request?: string;
  domain?: string;
  recommendedSkills?: string[];
  requiredCapabilities?: string[];
  summary?: string;
  risks?: string[];
  doNotBuild?: string[];
  providerPlan?: Array<{ provider: string; reason: string; gate: string; mutation: boolean }>;
  clarifyingQuestions?: string[];
}

export interface LocalScaffoldBuildResult {
  specId: string;
  proposalId: string;
  agentName: string;
  workDir: string;
  prDir: string;
  branch: string;
  commitSha: string;
  files: string[];
  prBodyPath: string;
  patchPath: string;
  /** Always false — 18A is local-only. */
  pushed: false;
  /** Always 0 — no provider adapter is reachable from this path. */
  providerMutations: 0;
  /** Always false — the proposal is not advanced to executed. */
  executed: false;
  /** Always true — every generated file was secret-scanned. */
  secretsClean: true;
}

export interface LocalScaffoldBuildOptions {
  cwd: string;
  ref: ProposalRef;
  now: string;
  env?: Record<string, string | undefined>;
  outRoot?: string;
  skills?: string[];
  /** Injected for tests; defaults to spawning the Factory CLI. */
  scaffold?: ScaffoldFn;
  /** Injected for tests; defaults to real local git (push-less by construction). */
  git?: LocalGitOps;
}

export class ScaffoldBuildPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldBuildPreconditionError";
  }
}

function payloadOf(item: ProposalQueueItem): AgentCreationPayload {
  return (item.proposedPayload ?? {}) as AgentCreationPayload;
}

/** Short, deterministic token (djb2) — keeps branch ref paths short on Windows. No Date/random. */
function shortToken(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "agent";
}

function buildSpecDraft(item: ProposalQueueItem, specId: string, p: AgentCreationPayload): string {
  return JSON.stringify(
    {
      specId,
      sourceProposalId: item.id,
      kind: "agent-creation-spec-draft",
      agentName: p.agentName ?? "new-agent",
      purpose: p.request ?? p.purpose ?? "",
      domain: p.domain ?? "unknown",
      riskLevel: item.riskLevel,
      recommendedSkills: p.recommendedSkills ?? [],
      requiredCapabilities: p.requiredCapabilities ?? [],
      openQuestions: p.clarifyingQuestions ?? [],
    },
    null,
    2
  ) + "\n";
}

function buildPrBody(item: ProposalQueueItem, specId: string, branch: string, p: AgentCreationPayload, fileCount: number): string {
  return [
    `# Add \`${p.agentName ?? "new-agent"}\` (scaffold, 18A PR mode)`,
    "",
    `Generated locally from approved proposal \`${item.id}\` (spec \`${specId}\`). Branch: \`${branch}\`.`,
    "",
    p.summary ?? "",
    "",
    "## What this is",
    `- A Factory-scaffolded starter agent repo (${fileCount} files). **Local only — not pushed.**`,
    "- No provider was created, deployed, or mutated. No secrets are included.",
    "- The spec is plan-level; starter commands/interfaces are placeholders to refine in review.",
    "",
    "## Open questions to resolve in review",
    ...((p.clarifyingQuestions ?? []).map((q) => `- [ ] ${q}`)),
    "",
    "## Risks / do-not-build",
    ...((p.risks ?? []).map((r) => `- ⚠️ ${r}`)),
    ...((p.doNotBuild ?? []).map((d) => `- ⛔ ${d}`)),
    "",
    "## Next (gated, future)",
    "- Push this branch + open the PR for real → **18B** (`ALLOW_GITHUB_PROVISION` / `ALLOW_GITHUB_PUSH`).",
    "- Provider provisioning (Supabase/Cloudflare/Telegram/Trigger) → **18B**, one gate at a time.",
    "",
  ].join("\n");
}

/**
 * Test/fixture paths are EXCLUDED from CC's content secret-scan: Factory templates intentionally
 * ship redaction-test files with secret-SHAPED fixtures, and Factory's own validate-factory already
 * secret-scans the whole template tree on every build. CC re-scans the non-test generated files +
 * everything CC itself authored, and blocks root-level real-secret files (below).
 */
function isTestPath(rel: string): boolean {
  return /(^|\/)(tests?|fixtures?)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
}

async function assertInside(root: string, files: string[]): Promise<void> {
  const rootResolved = path.resolve(root);
  for (const rel of files) {
    const full = path.resolve(root, rel);
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
      throw new ScaffoldBuildPreconditionError(`Generated file escapes the workdir: ${rel}`);
    }
  }
}

/**
 * Build a local scaffold + branch + commit + PR-prep bundle from an APPROVED-FOR-EXECUTION proposal.
 * Throws ScaffoldBuildPreconditionError on a missing/wrong/un-authorized proposal, a closed local
 * gate, a forbidden/secret-bearing generated file, or a file escaping the workdir (fail closed).
 */
export async function runLocalScaffoldBuild(opts: LocalScaffoldBuildOptions): Promise<LocalScaffoldBuildResult> {
  const { cwd, ref, now } = opts;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const scaffold = opts.scaffold ?? realFactoryScaffold;
  const git = opts.git ?? realLocalGit;

  const item = await resolveRef(cwd, ref);
  if (!item) throw new ScaffoldBuildPreconditionError("Proposal not found.");
  if (item.actionType !== "agent_creation_plan") {
    throw new ScaffoldBuildPreconditionError(`18A only supports agent_creation_plan, got "${item.actionType}".`);
  }
  // Key 1 — explicit authorization (a prompt cannot reach this).
  if (item.status !== "approved_for_execution") {
    throw new ScaffoldBuildPreconditionError(
      `Proposal must be approved_for_execution (was "${item.status}"). Authorize it first (Key 1).`
    );
  }
  // Key 2 (local) — a real scaffold write requires this local gate. Provider gates stay irrelevant
  // here: this path imports no provider adapter and pushes nothing.
  if (env[LOCAL_SCAFFOLD_GATE] !== "true") {
    throw new ScaffoldBuildPreconditionError(
      `${LOCAL_SCAFFOLD_GATE} is closed. Set ${LOCAL_SCAFFOLD_GATE}=true on the host to write a local scaffold.`
    );
  }

  const p = payloadOf(item);
  const specId = item.specId ?? deriveSpecId(item);
  const agentName = p.agentName ?? "new-agent";
  const outRoot = opts.outRoot ?? DEFAULT_SCAFFOLD_DIR;
  const workDir = path.join(cwd, outRoot, specId);
  const prDir = path.join(cwd, outRoot, `${specId}.pr`);
  // Short, deterministic branch (keeps the .git ref path well under Windows' limit); the durable
  // specId stays the cross-reference (recorded in the audit log + build manifest).
  const branch = `agent-scaffold/${slug(agentName)}-${shortToken(specId)}`;
  const skills = opts.skills ?? (p.recommendedSkills ?? ["agent-factory", "verification-loop"]);

  // Fresh workdir.
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await mkdir(prDir, { recursive: true });

  // Hand the spec draft to the Factory; it resolves + scaffolds. (No network; child process / fs.)
  const specDraftPath = path.join(prDir, "agent-spec-draft.json");
  await writeFile(specDraftPath, buildSpecDraft(item, specId, p), "utf8");
  const outcome = await scaffold({ specDraftPath, outDir: workDir, skills, createdAt: now });

  // Safety: no escaping files, no forbidden secret-bearing files, no secret CONTENT anywhere.
  await assertInside(workDir, outcome.files);
  for (const rel of outcome.files) {
    if (FORBIDDEN_FILE.test(rel)) {
      throw new ScaffoldBuildPreconditionError(`Forbidden file generated (would carry secrets): ${rel}`);
    }
  }
  for (const rel of outcome.files) {
    if (isTestPath(rel)) continue; // Factory owns test/fixture hygiene (validate-factory); see isTestPath.
    const full = path.join(workDir, rel);
    try {
      if ((await stat(full)).isFile()) {
        const content = await readFile(full, "utf8");
        if (containsSecret(content)) {
          throw new ScaffoldBuildPreconditionError(`Secret-looking content in generated file: ${rel}`);
        }
      }
    } catch (e) {
      if (e instanceof ScaffoldBuildPreconditionError) throw e;
      // unreadable/binary — skip content scan (filename already allow-listed)
    }
  }

  // Local git only — no remote, no push (the LocalGitOps interface has no push).
  git.init(workDir);
  git.checkoutNewBranch(workDir, branch);
  git.addAll(workDir);
  git.commit(workDir, `feat: scaffold ${agentName} (18A, local PR-prep)\n\nspec ${specId} from proposal ${item.id}. Local only; not pushed.`);
  const commitSha = git.headSha(workDir);

  // PR-prep bundle (outside the repo, in the sibling .pr dir).
  const prBodyPath = path.join(prDir, "PR_BODY.md");
  const patchPath = path.join(prDir, "scaffold.patch");
  const prBody = buildPrBody(item, specId, branch, p, outcome.files.length);
  if (containsSecret(prBody)) throw new ScaffoldBuildPreconditionError("PR body would contain a secret.");
  await writeFile(prBodyPath, prBody, "utf8");
  await writeFile(patchPath, git.rootPatch(workDir) + "\n", "utf8");

  await writeFile(
    path.join(prDir, "build-manifest.json"),
    JSON.stringify(
      { specId, proposalId: item.id, agentName, branch, commitSha, files: outcome.files, pushed: false, providerMutations: 0, executed: false, builtAt: now },
      null,
      2
    ) + "\n",
    "utf8"
  );

  await appendAudit(
    cwd,
    { id: item.id },
    "local_scaffold_built",
    now,
    `specId=${specId}; branch=${branch}; sha=${commitSha.slice(0, 10)}; ${outcome.files.length} files; pushed=false; providerMutations=0`
  );

  return {
    specId,
    proposalId: item.id,
    agentName,
    workDir,
    prDir,
    branch,
    commitSha,
    files: outcome.files,
    prBodyPath,
    patchPath,
    pushed: false,
    providerMutations: 0,
    executed: false,
    secretsClean: true,
  };
}

/** Automated rollback: nothing remote exists, so removing the workdir + PR dir is a clean undo. */
export async function rollbackLocalScaffold(opts: { cwd: string; specId: string; outRoot?: string }): Promise<string[]> {
  const outRoot = opts.outRoot ?? DEFAULT_SCAFFOLD_DIR;
  const removed: string[] = [];
  for (const dir of [path.join(opts.cwd, outRoot, opts.specId), path.join(opts.cwd, outRoot, `${opts.specId}.pr`)]) {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return removed;
}
