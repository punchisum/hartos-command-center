/**
 * src/beezulbub/manual-clone.ts
 *
 * Manual clone workflow for GitHub repository digestion.
 *
 * Phase 11B: Clone is manual_required unless BEEZULBUB_ALLOW_CLONE=true.
 * Even when allowed, repos are cloned to external-repos/ only.
 * Never copies third-party code into runtime/templates.
 */

import path from "node:path";

const EXTERNAL_REPOS_DIR = "external-repos";

/** Check if a string looks like a GitHub or Git URL */
export function isGitUrl(url: string): boolean {
  return (
    url.startsWith("https://github.com/") ||
    url.startsWith("https://gitlab.com/") ||
    url.startsWith("https://bitbucket.org/") ||
    url.startsWith("git@github.com:") ||
    url.startsWith("git@gitlab.com:") ||
    url.endsWith(".git")
  );
}

/** Extract a safe directory name from a repo URL */
export function repoUrlToLocalName(url: string): string {
  const cleaned = url
    .replace(/^https?:\/\//, "")
    .replace(/^git@[^:]+:/, "")
    .replace(/\.git$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  return cleaned;
}

/** Generate the exact git clone command */
export function generateCloneCommand(repoUrl: string, targetDir?: string): string {
  const localName = targetDir ?? repoUrlToLocalName(repoUrl);
  const clonePath = path.join(EXTERNAL_REPOS_DIR, localName);
  return `git clone ${repoUrl} ${clonePath}`;
}

/** Generate the full manual clone workflow instructions */
export function generateCloneInstructions(
  repoUrl: string,
  targetCapability?: string
): string {
  const localName = repoUrlToLocalName(repoUrl);
  const clonePath = path.join(EXTERNAL_REPOS_DIR, localName);
  const digestCmd = targetCapability
    ? `npm run beezulbub:digest -- --repo=${clonePath} --target=${targetCapability}`
    : `npm run beezulbub:digest -- --repo=${clonePath}`;

  return [
    `# Clone and digest: ${repoUrl}`,
    ``,
    `# Step 1: Clone the repository`,
    `mkdir -p ${EXTERNAL_REPOS_DIR}`,
    `git clone ${repoUrl} ${clonePath}`,
    ``,
    `# Step 2: Digest the cloned repo`,
    digestCmd,
    ``,
    `# Or set BEEZULBUB_ALLOW_CLONE=true to automate the clone step.`,
    `# Note: external-repos/ is gitignored — no third-party code enters the repo.`,
  ].join("\n");
}

export interface CloneCheckResult {
  allowed: boolean;
  clonePath: string | null;
  cloneCommand: string;
  fullInstructions: string;
  message: string;
}

/** Check whether auto-clone is allowed and return instructions */
export function checkClonePermission(
  repoUrl: string,
  env: Record<string, string | undefined>,
  targetCapability?: string
): CloneCheckResult {
  const allowClone = env["BEEZULBUB_ALLOW_CLONE"] === "true";
  const localName = repoUrlToLocalName(repoUrl);
  const clonePath = path.join(EXTERNAL_REPOS_DIR, localName);
  const cloneCommand = generateCloneCommand(repoUrl);
  const fullInstructions = generateCloneInstructions(repoUrl, targetCapability);

  if (!allowClone) {
    return {
      allowed: false,
      clonePath: null,
      cloneCommand,
      fullInstructions,
      message:
        `URL provided but auto-clone is not enabled. ` +
        `Set BEEZULBUB_ALLOW_CLONE=true to auto-clone, ` +
        `or clone manually:\n  ${cloneCommand}`,
    };
  }

  return {
    allowed: true,
    clonePath,
    cloneCommand,
    fullInstructions,
    message: `Clone allowed. Target: ${clonePath}`,
  };
}
