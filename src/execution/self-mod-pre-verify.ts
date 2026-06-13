/**
 * src/execution/self-mod-pre-verify.ts — Phase 6: the pre-modification gate.
 *
 * Before a self-mod run touches the working tree, capture a clean rollback anchor: the tree MUST be
 * clean (so the post-run diff is purely the self-mod's, and rollback is exact), and we record the
 * baseline (HEAD sha + the — required-empty — dirty set). Fail-closed: a dirty tree, or a cwd that is
 * not a git repo, refuses the run. Reuses W3's captureBaseline; injectable GitProbe so tests are hermetic.
 */
import { captureBaseline, realGitProbe, type GitProbe, type ExecBaseline } from "./claude-exec-baseline.js";

export interface PreVerifyResult {
  ok: boolean;
  /** The captured anchor — present whenever HEAD was readable (even on a dirty refusal, for diagnostics). */
  baseline?: ExecBaseline;
  reason: string;
}

/** Refuse unless the working tree is clean; return the baseline anchor the run/rollback will use. */
export function preVerifySelfMod(cwd: string, git: GitProbe = realGitProbe): PreVerifyResult {
  let baseline: ExecBaseline;
  try {
    baseline = captureBaseline(cwd, git);
  } catch (e) {
    return { ok: false, reason: `cannot capture baseline: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (baseline.preexistingDirty.length > 0) {
    return {
      ok: false,
      baseline,
      reason: `working tree not clean (${baseline.preexistingDirty.length} dirty path(s)) — self-mod needs a clean baseline`,
    };
  }
  return { ok: true, baseline, reason: "clean baseline captured" };
}
