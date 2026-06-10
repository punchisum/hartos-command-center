/**
 * src/wolverine/detectors/git-hygiene.ts
 *
 * Wolverine detector — git hygiene. Pure (operates on git facts the host gathered).
 *
 * Uncommitted work is risk-of-loss (sharper with concurrent sessions on one tree); unpushed
 * commits are work that exists only locally. Wolverine surfaces both so a marathon session's
 * output doesn't silently live only in a working tree.
 */

import type { WolverineFinding, WolverineInputs } from "../wolverine-types.js";

export const GIT_HYGIENE_DETECTOR = "git-hygiene";

export function detectGitHygiene(inputs: WolverineInputs): WolverineFinding[] {
  const git = inputs.git;
  if (!git) return []; // No git facts gathered (not a repo / unavailable) — assess nothing.
  const out: WolverineFinding[] = [];
  const branch = git.branch ?? "(unknown)";

  const uncommitted = git.uncommitted ?? 0;
  if (uncommitted > 0) {
    out.push({
      id: "git:uncommitted",
      category: "git_hygiene",
      severity: uncommitted >= 10 ? "high" : "medium",
      title: `Uncommitted changes (${uncommitted} file${uncommitted === 1 ? "" : "s"})`,
      evidence: `${uncommitted} modified/staged file(s) on '${branch}' — uncommitted work is at risk of loss, especially with concurrent sessions on the shared tree.`,
      ownerAgent: "HartOS repo",
      recommendedFix: "Commit the changes path-scoped (don't sweep in sibling-session files), or stash if mid-edit.",
      blastRadius: "Local only — committing records the working-tree state; no remote/system change.",
      rollbackPath: "git reset --soft HEAD~1 to uncommit; the files remain.",
      approvalRequired: false,
      confidence: "high",
      freshness: "git status, as of run",
      source: GIT_HYGIENE_DETECTOR,
    });
  }

  const untracked = git.untracked ?? 0;
  if (untracked > 0) {
    out.push({
      id: "git:untracked",
      category: "git_hygiene",
      severity: "low",
      title: `Untracked files (${untracked})`,
      evidence: `${untracked} untracked file(s) on '${branch}' — new files not yet added to git (or intentionally gitignored).`,
      ownerAgent: "HartOS repo",
      recommendedFix: "git add the intended new files, or add to .gitignore if they shouldn't be tracked.",
      blastRadius: "Local only.",
      rollbackPath: "git rm --cached to untrack again.",
      approvalRequired: false,
      confidence: "medium",
      freshness: "git status, as of run",
      source: GIT_HYGIENE_DETECTOR,
    });
  }

  const ahead = git.ahead ?? 0;
  if (git.hasUpstream && ahead > 0) {
    out.push({
      id: "git:unpushed",
      category: "git_hygiene",
      severity: ahead >= 5 ? "medium" : "low",
      title: `${ahead} commit${ahead === 1 ? "" : "s"} not pushed`,
      evidence: `'${branch}' is ${ahead} commit(s) ahead of its upstream — that work exists only on this machine.`,
      ownerAgent: "HartOS repo",
      recommendedFix: "Push the branch once you're ready to share/back it up (git push).",
      blastRadius: "Pushing updates the remote branch (no merge to main).",
      rollbackPath: "A pushed branch can be force-reset by the owner if needed.",
      approvalRequired: true,
      confidence: "high",
      freshness: "git rev-list, as of run",
      source: GIT_HYGIENE_DETECTOR,
    });
  }

  return out;
}
